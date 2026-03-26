from web3 import Web3
from web3.middleware.proof_of_authority import ExtraDataToPOAMiddleware
import json
import os

RPC_URL = os.getenv("WEB3_RPC_URL", "https://coston2.enosys.global/ext/C/rpc")

w3 = Web3(Web3.HTTPProvider(RPC_URL))

w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

contract_address = Web3.to_checksum_address(
    os.getenv("PRODUCT_TRACE_CONTRACT_ADDRESS", "0x3f610734fFf19Aa231fd3B0C8C83Eed61B2df386")
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(BASE_DIR, "abi.json")) as f:
    abi = json.load(f)

contract = w3.eth.contract(address=contract_address, abi=abi)