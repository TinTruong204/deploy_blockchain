import hashlib
import uuid
from datetime import date
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


def verify_contract_tx(tx_hash, expected_sender, expected_fn_name, expected_product_id, expected_hash):
    contract, contract_address, w3 = get_blockchain_ctx()

    tx = w3.eth.get_transaction(tx_hash)
    receipt = w3.eth.get_transaction_receipt(tx_hash)

    tx_sender = normalize_address(tx.get("from"))
    tx_to = tx.get("to")
    tx_to_normalized = normalize_address(tx_to) if tx_to else ""

    if receipt.status != 1:
        raise ValueError("Transaction failed on-chain")
    if tx_sender != normalize_address(expected_sender):
        raise ValueError("Transaction sender does not match connected wallet")
    if tx_to_normalized != normalize_address(contract_address):
        raise ValueError("Transaction target contract does not match ProductTrace")

    fn, fn_args = contract.decode_function_input(tx.get("input", "0x"))
    if fn.fn_name != expected_fn_name:
        raise ValueError(f"Unexpected contract function: {fn.fn_name}")

    onchain_uuid = fn_args.get("_uuid")
    onchain_hash = fn_args.get("_hash") or fn_args.get("_newHash")
    if str(onchain_uuid).strip().lower() != str(expected_product_id).strip().lower():
        raise ValueError("Product ID in transaction does not match request")
    if str(onchain_hash).strip().lower() != str(expected_hash).strip().lower():
        raise ValueError("Product hash in transaction does not match request")

    return receipt


def verify_product_version_onchain(product_id, version_item):
    contract, contract_address, w3 = get_blockchain_ctx()

    tx_hash = normalize_tx_hash(version_item.tx_hash)
    if not tx_hash:
        return {
            "ok": False,
            "reason": "Missing tx_hash",
        }

    try:
        tx = w3.eth.get_transaction(tx_hash)
        receipt = w3.eth.get_transaction_receipt(tx_hash)
    except Exception as error:
        return {
            "ok": False,
            "reason": f"Cannot load transaction: {error}",
        }

    if receipt.status != 1:
        return {
            "ok": False,
            "reason": "On-chain transaction failed",
        }

    tx_to = tx.get("to")
    if normalize_address(tx_to) != normalize_address(contract_address):
        return {
            "ok": False,
            "reason": "Transaction target is not ProductTrace contract",
        }

    try:
        fn, fn_args = contract.decode_function_input(tx.get("input", "0x"))
    except Exception as error:
        return {
            "ok": False,
            "reason": f"Cannot decode transaction input: {error}",
        }

    expected_fn_name = "addProduct" if version_item.version == 1 else "updateProduct"
    if fn.fn_name != expected_fn_name:
        return {
            "ok": False,
            "reason": f"Unexpected function {fn.fn_name}, expected {expected_fn_name}",
        }

    onchain_uuid = str((fn_args.get("_uuid") or "")).strip().lower()
    expected_uuid = str(product_id).strip().lower()
    if onchain_uuid != expected_uuid:
        return {
            "ok": False,
            "reason": "Product id mismatch between data and blockchain",
        }

    onchain_hash = str((fn_args.get("_hash") or fn_args.get("_newHash") or "")).strip().lower()
    if not onchain_hash:
        return {
            "ok": False,
            "reason": "Missing on-chain hash in transaction input",
            "onchain_hash": "",
        }

    return {
        "ok": True,
        "reason": "Verified",
        "tx_from": tx.get("from"),
        "tx_hash": tx_hash,
        "onchain_hash": onchain_hash,
    }


def build_image_sha256_from_cid(image_cid):
    if not image_cid:
        raise ValueError("Missing image CID")

    if not image_cid:
        raise ValueError("Invalid image CID")

    image_urls = [f"{prefix}{image_cid}" for prefix in IPFS_GATEWAY_PREFIXES]
    errors = []
    hasher = hashlib.sha256()

    for image_url in image_urls:
        hasher = hashlib.sha256()
        try:
            request = Request(image_url)
            if image_url.startswith("https://gateway.pinata.cloud/") and PINATA_JWT:
                request.add_header("Authorization", f"Bearer {PINATA_JWT}")

            with urlopen(request, timeout=15) as response:
                while True:
                    chunk = response.read(8192)
                    if not chunk:
                        break
                    hasher.update(chunk)

            return hasher.hexdigest()
        except (HTTPError, URLError, TimeoutError) as error:
            errors.append(f"{image_url} -> {error}")
            continue

    raise ValueError("Cannot fetch image from CID via all gateways: " + " | ".join(errors))


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
                "reason": f"Cannot recompute hash from current DB data: {error}",
                "onchain_hash": verify_result.get("onchain_hash"),
                "data_hash": stored_hash,
            }

        if recalculated_hash:
            onchain_hash = str(verify_result.get("onchain_hash") or "").strip().lower()
            recalculated_hash_lower = recalculated_hash.lower()

            if not onchain_hash:
                verify_result = {
                    "ok": False,
                    "reason": "Missing on-chain hash in transaction input",
                    "onchain_hash": onchain_hash,
                    "data_hash": stored_hash,
                    "recalculated_hash": recalculated_hash_lower,
                }
            elif onchain_hash != recalculated_hash_lower:
                verify_result = {
                    "ok": False,
                    "reason": "Recalculated hash from DB data does not match blockchain",
                    "onchain_hash": onchain_hash,
                    "data_hash": stored_hash,
                    "recalculated_hash": recalculated_hash_lower,
                }
            elif stored_hash != recalculated_hash_lower:
                verify_result = {
                    "ok": False,
                    "reason": "Stored DB hash does not match recalculated hash",
                    "onchain_hash": onchain_hash,
                    "data_hash": stored_hash,
                    "recalculated_hash": recalculated_hash_lower,
                }
            else:
                verify_result = {
                    "ok": True,
                    "reason": "Verified",
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
    return {
        "total_versions": len(results),
        "violated_versions": violated_versions,
        "is_safe": len(violated_versions) == 0,
        "results": results,
    }


def build_hash(name, origin, status):
    payload = {
        "action": "LEGACY",
        "id": "",
        "name": name,
        "origin": origin,
        "batch_code": "",
        "planting_area": "",
        "quantity_kg": "",
        "supplier_name": "",
        "owner_wallet": "",
        "version": "",
        "status": status,
        "location": "",
        "temperature_c": "",
        "humidity_percent": "",
        "note": "",
        "image_sha256": "",
    }
    return build_business_hash(payload)


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
        raise ValueError(f"{field_name} must be a valid number")


def parse_optional_date(raw_value, field_name):
    value = (raw_value or "").strip()
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{field_name} must be in YYYY-MM-DD format")


def upload_image_and_get_cid(image):
    pinata_response = upload_to_pinata(image)
    image_cid = pinata_response.get("IpfsHash")
    if not image_cid:
        raise ValueError(f"Pinata upload failed: {pinata_response}")
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
        return Response({"detail": "id, name, origin, wallet, and tx_hash are required"}, status=400)
    if not image:
        return Response({"detail": "image is required"}, status=400)

    try:
        uuid.UUID(product_id)
    except ValueError:
        return Response({"detail": "id must be a valid UUID"}, status=400)

    try:
        quantity_kg = parse_optional_decimal(request.data.get("quantity_kg"), "quantity_kg")
        temperature_c = parse_optional_decimal(request.data.get("temperature_c"), "temperature_c")
        humidity_percent = parse_optional_decimal(request.data.get("humidity_percent"), "humidity_percent")
    except ValueError as error:
        return Response({"detail": str(error)}, status=400)

    if quantity_kg is not None and quantity_kg < 0:
        return Response({"detail": "quantity_kg must be >= 0"}, status=400)

    if humidity_percent is not None and (humidity_percent < 0 or humidity_percent > 100):
        return Response({"detail": "humidity_percent must be between 0 and 100"}, status=400)

    if Product.objects.filter(id=product_id).exists():
        return Response({"detail": "Product already exists"}, status=409)

    image_sha256 = build_file_sha256(image)

    try:
        image_cid = upload_image_and_get_cid(image)
    except Exception as error:
        return Response({"detail": f"Image upload to Pinata failed: {error}"}, status=400)

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
    except Exception as error:
        product.delete()
        return Response({"detail": f"Blockchain transaction failed: {error}"}, status=503)

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
        return Response({"detail": "id is required"}, status=400)
    if not status:
        return Response({"detail": "status is required"}, status=400)
    if not wallet or not tx_hash:
        return Response({"detail": "wallet and tx_hash are required"}, status=400)
    if not image:
        return Response({"detail": "image is required"}, status=400)

    try:
        temperature_c = parse_optional_decimal(request.data.get("temperature_c"), "temperature_c")
        humidity_percent = parse_optional_decimal(request.data.get("humidity_percent"), "humidity_percent")
    except ValueError as error:
        return Response({"detail": str(error)}, status=400)

    if humidity_percent is not None and (humidity_percent < 0 or humidity_percent > 100):
        return Response({"detail": "humidity_percent must be between 0 and 100"}, status=400)

    product = get_object_or_404(Product, id=product_id)

    image_sha256 = build_file_sha256(image)

    try:
        image_cid = upload_image_and_get_cid(image)
    except Exception as error:
        return Response({"detail": f"Image upload to Pinata failed: {error}"}, status=400)

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
        return Response({"detail": "Only product owner can update this product"}, status=403)

    try:
        verify_contract_tx(
            tx_hash=tx_hash,
            expected_sender=wallet,
            expected_fn_name="updateProduct",
            expected_product_id=str(product.id),
            expected_hash=hash_value,
        )
    except Exception as error:
        return Response({"detail": f"Blockchain transaction failed: {error}"}, status=503)

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
        return Response({"detail": "wallet is required"}, status=400)

    search = (request.GET.get("search") or "").strip()
    status_filter = (request.GET.get("status") or "").strip().upper()

    try:
        page = int(request.GET.get("page") or 1)
    except ValueError:
        return Response({"detail": "page must be an integer"}, status=400)

    try:
        page_size = int(request.GET.get("page_size") or 9)
    except ValueError:
        return Response({"detail": "page_size must be an integer"}, status=400)

    if page < 1:
        return Response({"detail": "page must be >= 1"}, status=400)
    if page_size < 1 or page_size > 50:
        return Response({"detail": "page_size must be between 1 and 50"}, status=400)

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