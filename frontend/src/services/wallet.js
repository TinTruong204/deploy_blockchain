import { BrowserProvider, Contract } from "ethers";
import productTraceAbi from "../contracts/productTraceAbi.json";

const WALLET_STORAGE_KEY = "producttrace_wallet";
const PRODUCT_TRACE_CONTRACT_ADDRESS =
  import.meta.env.VITE_PRODUCT_TRACE_CONTRACT_ADDRESS || "0x32448a2Af76b555800AC594F858ec635a06A6878";

const HASH_FIELD_ORDER = [
  "action",
  "id",
  "name",
  "origin",
  "batch_code",
  "planting_area",
  "supplier_name",
  "owner_wallet",
  "version",
  "status",
  "location",
  "temperature_c",
  "humidity_percent",
  "note",
  "image_sha256",
];

const getInjectedProvider = () => {
  if (typeof window === "undefined") return null;
  return window.ethereum || null;
};

const getBrowserProvider = () => {
  const injectedProvider = getInjectedProvider();
  if (!injectedProvider) return null;
  return new BrowserProvider(injectedProvider);
};

const normalizeAddress = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value?.address === "string") return value.address;
  return "";
};

const getContractWithSigner = async () => {
  const provider = getBrowserProvider();
  if (!provider) {
    throw new Error("Không tìm thấy MetaMask. Vui lòng cài extension trước.");
  }

  const signer = await provider.getSigner();
  return new Contract(PRODUCT_TRACE_CONTRACT_ADDRESS, productTraceAbi, signer);
};

const toHex = (buffer) => {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const normalizeDecimalString = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const sign = raw.startsWith("-") ? "-" : "";
  const unsigned = raw.startsWith("-") || raw.startsWith("+") ? raw.slice(1) : raw;

  if (!/^\d+(\.\d+)?$/.test(unsigned)) {
    return raw;
  }

  let [integerPart, decimalPart = ""] = unsigned.split(".");
  integerPart = integerPart.replace(/^0+(?=\d)/, "");
  if (!integerPart) integerPart = "0";
  decimalPart = decimalPart.replace(/0+$/, "");

  return decimalPart ? `${sign}${integerPart}.${decimalPart}` : `${sign}${integerPart}`;
};

const normalizeHashField = (field, value) => {
  const text = String(value ?? "").trim();

  if (field === "owner_wallet") {
    return text.toLowerCase();
  }

  if (field === "status" || field === "action") {
    return text.toUpperCase();
  }

  if (field === "id") {
    return text.toLowerCase();
  }

  if (field === "temperature_c" || field === "humidity_percent") {
    return normalizeDecimalString(text);
  }

  if (field === "version") {
    const normalized = Number.parseInt(text, 10);
    return Number.isNaN(normalized) ? text : String(normalized);
  }

  return text;
};

const buildCanonicalPayload = (payload) => {
  const safePayload = payload || {};

  return HASH_FIELD_ORDER.map((field) => {
    const normalizedValue = normalizeHashField(field, safePayload[field]);
    return `${field}=${encodeURIComponent(normalizedValue)}`;
  }).join("|");
};

const getWalletErrorCode = (error) => {
  return error?.code || error?.info?.error?.code || error?.error?.code;
};

const includesAny = (value, keywords) => {
  if (!value) return false;
  const text = String(value).toLowerCase();
  return keywords.some((item) => text.includes(item));
};

export const getReadableWalletError = (error, fallbackMessage = "Giao dịch thất bại. Vui lòng thử lại.") => {
  const code = getWalletErrorCode(error);
  const message = error?.message || "";
  const nestedMessage = error?.info?.error?.message || error?.error?.message || "";

  if (code === 4001 || code === "ACTION_REJECTED") {
    return "Bạn đã hủy xác nhận giao dịch trong MetaMask.";
  }

  if (
    includesAny(message, ["insufficient funds", "insufficient balance"]) ||
    includesAny(nestedMessage, ["insufficient funds", "insufficient balance"])
  ) {
    return "Không đủ số dư để trả phí giao dịch (gas).";
  }

  if (includesAny(message, ["user rejected", "user denied", "rejected"]) || includesAny(nestedMessage, ["user rejected", "user denied", "rejected"])) {
    return "Bạn đã từ chối giao dịch.";
  }

  if (includesAny(message, ["nonce too low", "replacement transaction underpriced"]) || includesAny(nestedMessage, ["nonce too low", "replacement transaction underpriced"])) {
    return "Giao dịch đang bị xung đột nonce. Vui lòng thử lại sau vài giây.";
  }

  if (includesAny(message, ["network", "chain"]) && includesAny(message, ["unsupported", "wrong"])) {
    return "Sai mạng blockchain. Vui lòng chuyển MetaMask sang mạng đúng của dự án.";
  }

  return fallbackMessage;
};

export const buildProductHash = async (payload) => {
  const data = buildCanonicalPayload(payload);
  const encoded = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toHex(digest);
};

export const buildImageFileHash = async (file) => {
  if (!file) return "";
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return toHex(digest);
};

export const addProductOnChain = async (productId, hashValue) => {
  // Ghi hash CREATE lên contract và chờ giao dịch được xác nhận.
  const contract = await getContractWithSigner();
  const tx = await contract.addProduct(productId, hashValue);
  await tx.wait();
  return tx.hash;
};

export const updateProductOnChain = async (productId, hashValue) => {
  // Ghi hash UPDATE lên contract và chờ giao dịch được xác nhận.
  const contract = await getContractWithSigner();
  const tx = await contract.updateProduct(productId, hashValue);
  await tx.wait();
  return tx.hash;
};

export const connectWalletWithEthers = async () => {
  // Yêu cầu MetaMask cấp quyền truy cập ví, rồi trả về địa chỉ signer hiện tại.
  const provider = getBrowserProvider();
  if (!provider) {
    throw new Error("Không tìm thấy MetaMask. Vui lòng cài extension trước.");
  }

  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();

  if (!address) {
    throw new Error("Không nhận được tài khoản từ MetaMask.");
  }

  return address;
};

export const getConnectedWalletWithEthers = async () => {
  const provider = getBrowserProvider();
  if (!provider) return "";

  const accounts = await provider.listAccounts();
  if (!accounts?.length) return "";

  return normalizeAddress(accounts[0]);
};

export const subscribeWalletChanges = (onAddressChanged) => {
  const injectedProvider = getInjectedProvider();
  if (!injectedProvider) {
    return () => {};
  }

  const handler = (accounts) => {
    const nextAddress = Array.isArray(accounts) && accounts.length ? normalizeAddress(accounts[0]) : "";
    onAddressChanged(nextAddress);
  };

  injectedProvider.on("accountsChanged", handler);

  return () => {
    injectedProvider.removeListener("accountsChanged", handler);
  };
};

export { WALLET_STORAGE_KEY };