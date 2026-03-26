import hashlib
import uuid

from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Product, ProductVersion
from .pinata import upload_to_pinata


PINATA_GATEWAY_PREFIX = "https://gateway.pinata.cloud/ipfs/"


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
    if str(onchain_uuid) != str(expected_product_id):
        raise ValueError("Product ID in transaction does not match request")
    if str(onchain_hash) != str(expected_hash):
        raise ValueError("Product hash in transaction does not match request")

    return receipt


def build_hash(name, origin, status):
    data = f"{name}{origin}{status}"
    return hashlib.sha256(data.encode()).hexdigest()


def upload_image_and_get_cid(image):
    pinata_response = upload_to_pinata(image)
    image_cid = pinata_response.get("IpfsHash")
    if not image_cid:
        raise ValueError(f"Pinata upload failed: {pinata_response}")
    return image_cid


def cid_to_gateway_url(image_cid):
    if not image_cid:
        return None
    return f"{PINATA_GATEWAY_PREFIX}{image_cid}"


@api_view(["POST"])
def create_product(request):
    product_id = (request.data.get("id") or "").strip()
    name = (request.data.get("name") or "").strip()
    origin = (request.data.get("origin") or "").strip()
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

    if Product.objects.filter(id=product_id).exists():
        return Response({"detail": "Product already exists"}, status=409)

    try:
        image_cid = upload_image_and_get_cid(image)
    except Exception as error:
        return Response({"detail": f"Image upload to Pinata failed: {error}"}, status=400)

    status = "PLANTED"
    product = Product.objects.create(id=product_id, name=name, origin=origin, owner_wallet=wallet)
    hash_value = build_hash(name, origin, status)

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
        image_cid=image_cid,
        hash=hash_value,
        tx_hash=tx_hash,
    )

    return Response({"success": True, "id": str(product.id)})


@api_view(["POST"])
def update_product(request):
    product_id = (request.data.get("id") or "").strip()
    status = (request.data.get("status") or "").strip()
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

    product = get_object_or_404(Product, id=product_id)

    try:
        image_cid = upload_image_and_get_cid(image)
    except Exception as error:
        return Response({"detail": f"Image upload to Pinata failed: {error}"}, status=400)

    latest = ProductVersion.objects.filter(product=product).order_by("-version").first()
    new_version = latest.version + 1 if latest else 1
    hash_value = build_hash(product.name, product.origin, status)

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
            "owner_wallet": product.owner_wallet,
            "created_at": product.created_at,
        },
        "versions": [
            {
                "version": v.version,
                "status": v.status,
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

    products = Product.objects.filter(owner_wallet__iexact=wallet).order_by("-created_at")

    data = []
    for product in products:
        latest = ProductVersion.objects.filter(product=product).order_by("-version").first()
        data.append(
            {
                "id": str(product.id),
                "name": product.name,
                "origin": product.origin,
                "owner_wallet": product.owner_wallet,
                "created_at": product.created_at,
                "latest_version": {
                    "version": latest.version,
                    "status": latest.status,
                    "image": cid_to_gateway_url(latest.image_cid),
                    "tx_hash": latest.tx_hash,
                    "created_at": latest.created_at,
                }
                if latest
                else None,
            }
        )

    return Response({"products": data})