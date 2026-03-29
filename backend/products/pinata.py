import requests
import os

PINATA_API_KEY = os.getenv("PINATA_API_KEY", "")
PINATA_SECRET_API_KEY = os.getenv("PINATA_SECRET_API_KEY", "")
PINATA_JWT = os.getenv("PINATA_JWT", "").strip()

def upload_to_pinata(file):
    if not PINATA_JWT and (not PINATA_API_KEY or not PINATA_SECRET_API_KEY):
        raise ValueError("Pinata credentials are not configured (set PINATA_JWT or API key/secret)")

    url = "https://api.pinata.cloud/pinning/pinFileToIPFS"

    files = {
        'file': file
    }

    headers = {}
    if PINATA_JWT:
        headers["Authorization"] = f"Bearer {PINATA_JWT}"
    else:
        headers["pinata_api_key"] = PINATA_API_KEY
        headers["pinata_secret_api_key"] = PINATA_SECRET_API_KEY

    response = requests.post(url, files=files, headers=headers, timeout=30)
    try:
        payload = response.json()
    except ValueError:
        payload = {"detail": response.text}

    if response.status_code >= 400:
        raise ValueError(f"Pinata API error {response.status_code}: {payload}")

    return payload