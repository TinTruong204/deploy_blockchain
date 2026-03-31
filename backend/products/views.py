import hashlib
import uuid
from decimal import Decimal, InvalidOperation
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import os

from django.core.paginator import EmptyPage, Paginator
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Product, ProductVersion
from .pinata import upload_to_pinata


PINATA_GATEWAY_PREFIX = "https://gateway.pinata.cloud/ipfs/"
PINATA_GATEWAY_TOKEN = os.getenv("PINATA_GATEWAY_TOKEN", "").strip()
PINATA_JWT = os.getenv("PINATA_JWT", "").strip()

IPFS_GATEWAY_PREFIXES = [
    "https://gateway.pinata.cloud/ipfs/",
    "https://ipfs.io/ipfs/",
    "https://cloudflare-ipfs.com/ipfs/",
]

HASH_FIELD_ORDER = [
    "action",
    "id",
    "name",
    "origin",
    "batch_code",
    "planting_area",
    "quantity_kg",
    "supplier_name",
    "owner_wallet",
    "version",
    "status",
    "location",
    "temperature_c",
    "humidity_percent",
    "note",
    "image_sha256",
]

# Match JavaScript encodeURIComponent behavior for canonical payload generation.
JS_ENCODE_URI_COMPONENT_SAFE = "-_.!~*'()"


def get_blockchain_ctx():
    from .blockchain import contract, contract_address, w3

    return contract, contract_address, w3


def normalize_tx_hash(tx_hash):
    if not tx_hash:
        return ""
    value = tx_hash.strip()
    if not value.startswith("0x"):
        value = f"0x{value}"
    return value


def normalize_address(address):
    if not address:
        return ""
    return address.strip().lower()


def product_exists_onchain(product_id):
    contract, _, _ = get_blockchain_ctx()
    return bool(contract.functions.productExistsCheck(str(product_id)).call())


def get_product_onchain(product_id):
    contract, _, _ = get_blockchain_ctx()
    # ABI getProduct returns: (hash, owner, metadata, timestamp)
    return contract.functions.getProduct(str(product_id)).call()


def verify_contract_tx(tx_hash, expected_sender, expected_fn_name, expected_product_id, expected_hash):
    contract, contract_address, w3 = get_blockchain_ctx()

    tx = w3.eth.get_transaction(tx_hash)
    receipt = w3.eth.get_transaction_receipt(tx_hash)

    tx_sender = normalize_address(tx.get("from"))
    tx_to = tx.get("to")
    tx_to_normalized = normalize_address(tx_to) if tx_to else ""

    if receipt.status != 1:
        raise ValueError("Giao dịch thất bại trên blockchain")
    if tx_sender != normalize_address(expected_sender):
        raise ValueError("Ví gửi giao dịch không khớp với ví đã kết nối")
    if tx_to_normalized != normalize_address(contract_address):
        raise ValueError("Địa chỉ contract đích không khớp với ProductTrace")

    fn, fn_args = contract.decode_function_input(tx.get("input", "0x"))
    if fn.fn_name != expected_fn_name:
        raise ValueError(f"Hàm contract không đúng: {fn.fn_name}")

    onchain_uuid = fn_args.get("_uuid")
    onchain_hash = fn_args.get("_hash") or fn_args.get("_newHash")
    if str(onchain_uuid).strip().lower() != str(expected_product_id).strip().lower():
        raise ValueError("Mã sản phẩm trong giao dịch không khớp với yêu cầu")
    if str(onchain_hash).strip().lower() != str(expected_hash).strip().lower():
        raise ValueError("Hash sản phẩm trong giao dịch không khớp với yêu cầu")

    return receipt


def verify_product_version_onchain(product_id, version_item):
    contract, contract_address, w3 = get_blockchain_ctx()

    tx_hash = normalize_tx_hash(version_item.tx_hash)
    if not tx_hash:
        return {
            "ok": False,
            "reason": "Thiếu tx_hash",
        }

    try:
        tx = w3.eth.get_transaction(tx_hash)
        receipt = w3.eth.get_transaction_receipt(tx_hash)
    except Exception as error:
        return {
            "ok": False,
            "reason": f"Không thể tải giao dịch: {error}",
        }

    if receipt.status != 1:
        return {
            "ok": False,
            "reason": "Giao dịch trên blockchain thất bại",
        }

    tx_to = tx.get("to")
    if normalize_address(tx_to) != normalize_address(contract_address):
        return {
            "ok": False,
            "reason": "Địa chỉ nhận giao dịch không phải contract ProductTrace",
        }

    try:
        fn, fn_args = contract.decode_function_input(tx.get("input", "0x"))
    except Exception as error:
        return {
            "ok": False,
            "reason": f"Không thể giải mã input của giao dịch: {error}",
        }

    expected_fn_name = "addProduct" if version_item.version == 1 else "updateProduct"
    if fn.fn_name != expected_fn_name:
        return {
            "ok": False,
            "reason": f"Hàm {fn.fn_name} không đúng, mong đợi {expected_fn_name}",
        }

    onchain_uuid = str((fn_args.get("_uuid") or "")).strip().lower()
    expected_uuid = str(product_id).strip().lower()
    if onchain_uuid != expected_uuid:
        return {
            "ok": False,
            "reason": "Mã sản phẩm giữa dữ liệu và blockchain không khớp",
        }

    onchain_hash = str((fn_args.get("_hash") or fn_args.get("_newHash") or "")).strip().lower()
    if not onchain_hash:
        return {
            "ok": False,
            "reason": "Thiếu hash on-chain trong input giao dịch",
            "onchain_hash": "",
        }

    return {
        "ok": True,
        "reason": "Đã xác minh",
        "tx_from": tx.get("from"),
        "tx_hash": tx_hash,
        "onchain_hash": onchain_hash,
    }


def build_image_sha256_from_cid(image_cid):
    if not image_cid:
        raise ValueError("Thiếu CID ảnh")

    image_urls = [f"{prefix}{image_cid}" for prefix in IPFS_GATEWAY_PREFIXES]
    errors = []

    for image_url in image_urls:
        hasher = hashlib.sha256()
        try:
            request = Request(image_url)
            if image_url.startswith("https://gateway.pinata.cloud/"):
                if PINATA_GATEWAY_TOKEN:
                    separator = "&" if "?" in image_url else "?"
                    request = Request(f"{image_url}{separator}pinataGatewayToken={PINATA_GATEWAY_TOKEN}")
                elif PINATA_JWT:
                    request.add_header("Authorization", f"Bearer {PINATA_JWT}")

            with urlopen(request, timeout=45) as response:
                while True:
                    chunk = response.read(8192)
                    if not chunk:
                        break
                    hasher.update(chunk)

            return hasher.hexdigest()
        except (HTTPError, URLError, TimeoutError) as error:
            errors.append(f"{image_url} -> {error}")
            continue

    raise ValueError("Không thể tải ảnh từ CID qua tất cả gateway: " + " | ".join(errors))


def build_expected_hash_for_version(product, version_item):
    image_sha256 = build_image_sha256_from_cid(version_item.image_cid)
    payload = {
        "action": "CREATE" if version_item.version == 1 else "UPDATE",
        "id": str(product.id),
        "name": product.name,
        "origin": product.origin,
        "batch_code": product.batch_code,
        "planting_area": product.planting_area,
        "quantity_kg": product.quantity_kg,
        "supplier_name": product.supplier_name,
        "owner_wallet": product.owner_wallet,
        "version": version_item.version,
        "status": version_item.status,
        "location": version_item.location,
        "temperature_c": version_item.temperature_c,
        "humidity_percent": version_item.humidity_percent,
        "note": version_item.note,
        "image_sha256": image_sha256,
    }
    return build_business_hash(payload)


def verify_product_versions(product):
    versions = ProductVersion.objects.filter(product=product).order_by("version")
    results = []

    for version_item in versions:
        verify_result = verify_product_version_onchain(product.id, version_item)
        recalculated_hash = None
        stored_hash = str(version_item.hash or "").strip().lower()

        if not verify_result.get("ok"):
            results.append(
                {
                    "version": version_item.version,
                    "tx_hash": version_item.tx_hash,
                    "ok": False,
                    "warning": verify_result.get("reason"),
                    "reason": verify_result.get("reason"),
                    "onchain_hash": verify_result.get("onchain_hash"),
                    "data_hash": stored_hash,
                    "recalculated_hash": None,
                }
            )
            continue

        try:
            recalculated_hash = build_expected_hash_for_version(product, version_item)
        except Exception as error:
            verify_result = {
                "ok": False,
                "reason": f"Không thể tính lại hash từ dữ liệu DB hiện tại: {error}",
                "onchain_hash": verify_result.get("onchain_hash"),
                "data_hash": stored_hash,
            }

        if recalculated_hash:
            onchain_hash = str(verify_result.get("onchain_hash") or "").strip().lower()
            recalculated_hash_lower = recalculated_hash.lower()

            if not onchain_hash:
                verify_result = {
                    "ok": False,
                    "reason": "Thiếu hash on-chain trong input giao dịch",
                    "onchain_hash": onchain_hash,
                    "data_hash": stored_hash,
                    "recalculated_hash": recalculated_hash_lower,
                }
            elif onchain_hash != recalculated_hash_lower:
                verify_result = {
                    "ok": False,
                    "reason": "Hash tính lại từ DB không khớp với blockchain",
                    "onchain_hash": onchain_hash,
                    "data_hash": stored_hash,
                    "recalculated_hash": recalculated_hash_lower,
                }
            elif stored_hash != recalculated_hash_lower:
                verify_result = {
                    "ok": False,
                    "reason": "Hash lưu trong DB không khớp với hash tính lại",
                    "onchain_hash": onchain_hash,
                    "data_hash": stored_hash,
                    "recalculated_hash": recalculated_hash_lower,
                }
            else:
                verify_result = {
                    "ok": True,
                    "reason": "Đã xác minh",
                    "onchain_hash": onchain_hash,
                    "data_hash": stored_hash,
                    "recalculated_hash": recalculated_hash_lower,
                }

        results.append(
            {
                "version": version_item.version,
                "tx_hash": version_item.tx_hash,
                "ok": verify_result.get("ok", False),
                "warning": None if verify_result.get("ok") else verify_result.get("reason"),
                "reason": verify_result.get("reason"),
                "onchain_hash": verify_result.get("onchain_hash"),
                "data_hash": verify_result.get("data_hash") or version_item.hash,
                "recalculated_hash": verify_result.get("recalculated_hash"),
            }
        )

    violated_versions = [item["version"] for item in results if not item["ok"]]

    latest_db_version = versions.last() if versions.exists() else None
    chain_state = {
        "checked": False,
        "exists": False,
        "hash": "",
        "owner": "",
        "matches_latest_db_hash": None,
        "matches_product_owner": None,
        "reason": None,
    }

    try:
        chain_exists = product_exists_onchain(product.id)
        chain_state["checked"] = True
        chain_state["exists"] = chain_exists

        if chain_exists:
            chain_hash, chain_owner, _, _ = get_product_onchain(product.id)
            chain_hash_norm = str(chain_hash or "").strip().lower()
            chain_owner_norm = normalize_address(chain_owner)
            latest_db_hash = str((latest_db_version.hash if latest_db_version else "") or "").strip().lower()

            chain_state["hash"] = chain_hash_norm
            chain_state["owner"] = chain_owner
            chain_state["matches_latest_db_hash"] = bool(latest_db_hash) and (chain_hash_norm == latest_db_hash)
            chain_state["matches_product_owner"] = chain_owner_norm == normalize_address(product.owner_wallet)

            if latest_db_version and chain_hash_norm and chain_hash_norm != latest_db_hash:
                chain_state["reason"] = "Hash mới nhất trong DB không khớp hash sản phẩm hiện tại trên blockchain"
            elif chain_owner_norm != normalize_address(product.owner_wallet):
                chain_state["reason"] = "Ví owner trong DB không khớp owner hiện tại trên blockchain"
        else:
            chain_state["reason"] = "Sản phẩm không tồn tại trên blockchain"
    except Exception as error:
        chain_state["checked"] = False
        chain_state["reason"] = f"Không thể truy vấn trạng thái sản phẩm trên blockchain: {error}"

    if chain_state["checked"]:
        if not chain_state["exists"]:
            violated_versions.append("chain_state")
        elif chain_state.get("matches_latest_db_hash") is False:
            violated_versions.append("chain_hash_mismatch")
        elif chain_state.get("matches_product_owner") is False:
            violated_versions.append("chain_owner_mismatch")

    violated_versions = list(dict.fromkeys(violated_versions))
    return {
        "total_versions": len(results),
        "violated_versions": violated_versions,
        "is_safe": len(violated_versions) == 0,
        "chain_state": chain_state,
        "results": results,
    }


def decimal_to_hash_string(value):
    if value is None:
        return ""

    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def normalize_hash_field(field, value):
    text = "" if value is None else str(value).strip()

    if field == "owner_wallet":
        return normalize_address(text)

    if field in {"status", "action"}:
        return text.upper()

    if field == "id":
        return text.lower()

    if field in {"quantity_kg", "temperature_c", "humidity_percent"}:
        if value is None:
            return ""
        if isinstance(value, Decimal):
            return decimal_to_hash_string(value)
        try:
            return decimal_to_hash_string(Decimal(text))
        except (InvalidOperation, ValueError):
            return text

    if field == "version":
        if text == "":
            return ""
        try:
            return str(int(text))
        except ValueError:
            return text

    return text


def build_canonical_hash_payload(payload):
    parts = []

    for field in HASH_FIELD_ORDER:
        normalized = normalize_hash_field(field, payload.get(field, ""))
        parts.append(f"{field}={quote(str(normalized), safe=JS_ENCODE_URI_COMPONENT_SAFE)}")

    return "|".join(parts)


def build_business_hash(payload):
    canonical = build_canonical_hash_payload(payload)
    return hashlib.sha256(canonical.encode()).hexdigest()


def parse_optional_decimal(raw_value, field_name):
    value = (raw_value or "").strip()
    if not value:
        return None
    try:
        return Decimal(value)
    except (InvalidOperation, ValueError):
        raise ValueError(f"{field_name} phải là số hợp lệ")


def upload_image_and_get_cid(image):
    pinata_response = upload_to_pinata(image)
    image_cid = pinata_response.get("IpfsHash")
    if not image_cid:
        raise ValueError(f"Tải ảnh lên Pinata thất bại: {pinata_response}")
    return image_cid


def build_file_sha256(uploaded_file):
    hasher = hashlib.sha256()
    for chunk in uploaded_file.chunks():
        hasher.update(chunk)

    uploaded_file.seek(0)
    return hasher.hexdigest()


def cid_to_gateway_url(image_cid):
    if not image_cid:
        return None
    return f"{PINATA_GATEWAY_PREFIX}{image_cid}"


@api_view(["POST"])
def create_product(request):
    product_id = (request.data.get("id") or "").strip()
    name = (request.data.get("name") or "").strip()
    origin = (request.data.get("origin") or "").strip()
    batch_code = (request.data.get("batch_code") or "").strip()
    planting_area = (request.data.get("planting_area") or "").strip()
    supplier_name = (request.data.get("supplier_name") or "").strip()
    location = (request.data.get("location") or "").strip()
    note = (request.data.get("note") or "").strip()
    wallet = normalize_address(request.data.get("wallet"))
    tx_hash = normalize_tx_hash(request.data.get("tx_hash") or "")
    image = request.FILES.get("image")

    if not product_id or not name or not origin or not wallet or not tx_hash:
        return Response({"detail": "Bắt buộc có id, name, origin, wallet và tx_hash"}, status=400)
    if not image:
        return Response({"detail": "Bắt buộc có ảnh"}, status=400)

    try:
        uuid.UUID(product_id)
    except ValueError:
        return Response({"detail": "id phải là UUID hợp lệ"}, status=400)

    try:
        quantity_kg = parse_optional_decimal(request.data.get("quantity_kg"), "quantity_kg")
        temperature_c = parse_optional_decimal(request.data.get("temperature_c"), "temperature_c")
        humidity_percent = parse_optional_decimal(request.data.get("humidity_percent"), "humidity_percent")
    except ValueError as error:
        return Response({"detail": str(error)}, status=400)

    if quantity_kg is not None and quantity_kg < 0:
        return Response({"detail": "quantity_kg phải lớn hơn hoặc bằng 0"}, status=400)

    if humidity_percent is not None and (humidity_percent < 0 or humidity_percent > 100):
        return Response({"detail": "humidity_percent phải trong khoảng từ 0 đến 100"}, status=400)

    if Product.objects.filter(id=product_id).exists():
        return Response({"detail": "Sản phẩm đã tồn tại"}, status=409)

    image_sha256 = build_file_sha256(image)

    try:
        image_cid = upload_image_and_get_cid(image)
    except Exception as error:
        return Response({"detail": f"Tải ảnh lên Pinata thất bại: {error}"}, status=400)

    status = "PLANTED"
    product = Product.objects.create(
        id=product_id,
        name=name,
        origin=origin,
        batch_code=batch_code,
        planting_area=planting_area,
        quantity_kg=quantity_kg,
        supplier_name=supplier_name,
        owner_wallet=wallet,
    )
    hash_value = build_business_hash(
        {
            "action": "CREATE",
            "id": str(product.id),
            "name": name,
            "origin": origin,
            "batch_code": batch_code,
            "planting_area": planting_area,
            "quantity_kg": quantity_kg,
            "supplier_name": supplier_name,
            "owner_wallet": wallet,
            "version": 1,
            "status": status,
            "location": location,
            "temperature_c": temperature_c,
            "humidity_percent": humidity_percent,
            "note": note,
            "image_sha256": image_sha256,
        }
    )

    try:
        verify_contract_tx(
            tx_hash=tx_hash,
            expected_sender=wallet,
            expected_fn_name="addProduct",
            expected_product_id=str(product.id),
            expected_hash=hash_value,
        )

        if not product_exists_onchain(product.id):
            raise ValueError("Sản phẩm chưa tồn tại trên blockchain sau addProduct")

        onchain_hash, onchain_owner, _, _ = get_product_onchain(product.id)
        if str(onchain_hash or "").strip().lower() != hash_value.lower():
            raise ValueError("Hash sản phẩm trên blockchain không khớp hash kỳ vọng")
        if normalize_address(onchain_owner) != wallet:
            raise ValueError("Owner sản phẩm trên blockchain không khớp ví đã kết nối")
    except Exception as error:
        product.delete()
        return Response({"detail": f"Xác thực giao dịch blockchain thất bại: {error}"}, status=503)

    ProductVersion.objects.create(
        product=product,
        version=1,
        status=status,
        location=location,
        temperature_c=temperature_c,
        humidity_percent=humidity_percent,
        note=note,
        image_cid=image_cid,
        hash=hash_value,
        tx_hash=tx_hash,
    )

    return Response({"success": True, "id": str(product.id)})


@api_view(["POST"])
def update_product(request):
    product_id = (request.data.get("id") or "").strip()
    status = (request.data.get("status") or "").strip()
    location = (request.data.get("location") or "").strip()
    note = (request.data.get("note") or "").strip()
    wallet = normalize_address(request.data.get("wallet"))
    tx_hash = normalize_tx_hash(request.data.get("tx_hash") or "")
    image = request.FILES.get("image")

    if not product_id:
        return Response({"detail": "Bắt buộc có id"}, status=400)
    if not status:
        return Response({"detail": "Bắt buộc có status"}, status=400)
    if not wallet or not tx_hash:
        return Response({"detail": "Bắt buộc có wallet và tx_hash"}, status=400)
    if not image:
        return Response({"detail": "Bắt buộc có ảnh"}, status=400)

    try:
        temperature_c = parse_optional_decimal(request.data.get("temperature_c"), "temperature_c")
        humidity_percent = parse_optional_decimal(request.data.get("humidity_percent"), "humidity_percent")
    except ValueError as error:
        return Response({"detail": str(error)}, status=400)

    if humidity_percent is not None and (humidity_percent < 0 or humidity_percent > 100):
        return Response({"detail": "humidity_percent phải trong khoảng từ 0 đến 100"}, status=400)

    product = get_object_or_404(Product, id=product_id)

    image_sha256 = build_file_sha256(image)

    try:
        image_cid = upload_image_and_get_cid(image)
    except Exception as error:
        return Response({"detail": f"Tải ảnh lên Pinata thất bại: {error}"}, status=400)

    latest = ProductVersion.objects.filter(product=product).order_by("-version").first()
    new_version = latest.version + 1 if latest else 1
    hash_value = build_business_hash(
        {
            "action": "UPDATE",
            "id": str(product.id),
            "name": product.name,
            "origin": product.origin,
            "batch_code": product.batch_code,
            "planting_area": product.planting_area,
            "quantity_kg": product.quantity_kg,
            "supplier_name": product.supplier_name,
            "owner_wallet": product.owner_wallet,
            "version": new_version,
            "status": status,
            "location": location,
            "temperature_c": temperature_c,
            "humidity_percent": humidity_percent,
            "note": note,
            "image_sha256": image_sha256,
        }
    )

    if normalize_address(product.owner_wallet) != wallet:
        return Response({"detail": "Chỉ owner sản phẩm mới được cập nhật sản phẩm này"}, status=403)

    try:
        if not product_exists_onchain(product.id):
            return Response({"detail": "Sản phẩm không tồn tại trên blockchain"}, status=409)
    except Exception as error:
        return Response({"detail": f"Không thể kiểm tra sự tồn tại on-chain của sản phẩm: {error}"}, status=503)

    try:
        verify_contract_tx(
            tx_hash=tx_hash,
            expected_sender=wallet,
            expected_fn_name="updateProduct",
            expected_product_id=str(product.id),
            expected_hash=hash_value,
        )

        onchain_hash, onchain_owner, _, _ = get_product_onchain(product.id)
        if str(onchain_hash or "").strip().lower() != hash_value.lower():
            raise ValueError("Hash sản phẩm trên blockchain không khớp hash kỳ vọng")
        if normalize_address(onchain_owner) != wallet:
            raise ValueError("Owner sản phẩm trên blockchain không khớp ví đã kết nối")
    except Exception as error:
        return Response({"detail": f"Xác thực giao dịch blockchain thất bại: {error}"}, status=503)

    ProductVersion.objects.create(
        product=product,
        version=new_version,
        status=status,
        location=location,
        temperature_c=temperature_c,
        humidity_percent=humidity_percent,
        note=note,
        image_cid=image_cid,
        hash=hash_value,
        tx_hash=tx_hash,
    )

    return Response({"success": True, "id": str(product.id), "version": new_version})


@api_view(["GET"])
def get_product(request, id):
    product = get_object_or_404(Product, id=id)
    versions = ProductVersion.objects.filter(product=product).order_by("version")

    data = {
        "product": {
            "id": str(product.id),
            "name": product.name,
            "origin": product.origin,
            "batch_code": product.batch_code,
            "planting_area": product.planting_area,
            "quantity_kg": product.quantity_kg,
            "supplier_name": product.supplier_name,
            "owner_wallet": product.owner_wallet,
            "created_at": product.created_at,
        },
        "versions": [
            {
                "version": v.version,
                "status": v.status,
                "location": v.location,
                "temperature_c": v.temperature_c,
                "humidity_percent": v.humidity_percent,
                "note": v.note,
                "image": cid_to_gateway_url(v.image_cid),
                "hash": v.hash,
                "tx_hash": v.tx_hash,
                "created_at": v.created_at,
            }
            for v in versions
        ],
    }

    return Response(data)


@api_view(["GET"])
def get_products_by_wallet(request):
    wallet = (request.GET.get("wallet") or "").strip()
    if not wallet:
        return Response({"detail": "Bắt buộc có wallet"}, status=400)

    search = (request.GET.get("search") or "").strip()
    status_filter = (request.GET.get("status") or "").strip().upper()

    try:
        page = int(request.GET.get("page") or 1)
    except ValueError:
        return Response({"detail": "page phải là số nguyên"}, status=400)

    try:
        page_size = int(request.GET.get("page_size") or 9)
    except ValueError:
        return Response({"detail": "page_size phải là số nguyên"}, status=400)

    if page < 1:
        return Response({"detail": "page phải lớn hơn hoặc bằng 1"}, status=400)
    if page_size < 1 or page_size > 50:
        return Response({"detail": "page_size phải trong khoảng từ 1 đến 50"}, status=400)

    products = Product.objects.filter(owner_wallet__iexact=wallet)

    if search:
        products = products.filter(Q(name__icontains=search) | Q(origin__icontains=search))

    products = products.order_by("-created_at")

    data = []
    for product in products:
        latest = ProductVersion.objects.filter(product=product).order_by("-version").first()

        if status_filter and (not latest or (latest.status or "").upper() != status_filter):
            continue

        data.append(
            {
                "id": str(product.id),
                "name": product.name,
                "origin": product.origin,
                "batch_code": product.batch_code,
                "supplier_name": product.supplier_name,
                "owner_wallet": product.owner_wallet,
                "created_at": product.created_at,
                "latest_version": {
                    "version": latest.version,
                    "status": latest.status,
                    "location": latest.location,
                    "image": cid_to_gateway_url(latest.image_cid),
                    "tx_hash": latest.tx_hash,
                    "created_at": latest.created_at,
                }
                if latest
                else None,
            }
        )

    paginator = Paginator(data, page_size)

    try:
        page_obj = paginator.page(page)
    except EmptyPage:
        page_obj = paginator.page(paginator.num_pages) if paginator.num_pages > 0 else []

    items = list(page_obj.object_list) if paginator.count > 0 else []
    current_page = page_obj.number if paginator.count > 0 else 1
    total_pages = paginator.num_pages if paginator.count > 0 else 0

    return Response(
        {
            "products": items,
            "pagination": {
                "page": current_page,
                "page_size": page_size,
                "total_items": paginator.count,
                "total_pages": total_pages,
                "has_next": page_obj.has_next() if paginator.count > 0 else False,
                "has_previous": page_obj.has_previous() if paginator.count > 0 else False,
            },
            "filters": {
                "search": search,
                "status": status_filter,
            },
        }
    )


@api_view(["GET"])
def verify_product_versions_view(request, id):
    product = get_object_or_404(Product, id=id)
    verify_result = verify_product_versions(product)

    return Response(
        {
            "product_id": str(product.id),
            "product_name": product.name,
            "owner_wallet": product.owner_wallet,
            **verify_result,
        }
    )