import requests
import os

PINATA_API_KEY = os.getenv("PINATA_API_KEY", "")
PINATA_SECRET_API_KEY = os.getenv("PINATA_SECRET_API_KEY", "")

def upload_to_pinata(file):
    if not PINATA_API_KEY or not PINATA_SECRET_API_KEY:
        raise ValueError("Pinata credentials are not configured")

    url = "https://api.pinata.cloud/pinning/pinFileToIPFS"

    files = {
        'file': file
    }

    headers = {
        "pinata_api_key": PINATA_API_KEY,
        "pinata_secret_api_key": PINATA_SECRET_API_KEY
    }

    response = requests.post(url, files=files, headers=headers)

    return response.json()