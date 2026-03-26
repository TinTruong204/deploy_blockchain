import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../services/api";
import "../assets/formPages.css";
import {
  addProductOnChain,
  buildProductHash,
  connectWalletWithEthers,
  getReadableWalletError,
  WALLET_STORAGE_KEY,
} from "../services/wallet";

export default function Create() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [image, setImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [wallet, setWallet] = useState("");
  const [status, setStatus] = useState("Điền thông tin và hình ảnh để tạo sản phẩm.");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const shortWallet = useMemo(() => {
    if (!wallet) return "Chưa kết nối";
    return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
  }, [wallet]);

  const connectWallet = async () => {
    try {
      setIsConnecting(true);
      setStatus("Đang mở MetaMask...");

      const account = await connectWalletWithEthers();
      setWallet(account);
      localStorage.setItem(WALLET_STORAGE_KEY, account);
      setStatus("Kết nối ví thành công (ethers).");
    } catch (error) {
      setStatus(getReadableWalletError(error, "Kết nối ví thất bại. Vui lòng thử lại."));
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    if (!image) {
      setPreviewUrl("");
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(image);
    setPreviewUrl(nextPreviewUrl);

    return () => {
      URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [image]);

  useEffect(() => {
    const cachedWallet = localStorage.getItem(WALLET_STORAGE_KEY);
    if (cachedWallet) {
      setWallet(cachedWallet);
    }
  }, []);

  const onSelectImageFile = (file) => {
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      setStatus("File không hợp lệ. Vui lòng chọn ảnh (jpg, png, webp...).");
      return;
    }

    setImage(file);
    setStatus("Đã chọn ảnh sản phẩm.");
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);

    const droppedFile = event.dataTransfer?.files?.[0];
    onSelectImageFile(droppedFile);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!name.trim() || !origin.trim() || !image) {
      setStatus("Vui lòng nhập đầy đủ Name, Origin và chọn ảnh sản phẩm.");
      return;
    }

    if (!wallet) {
      setStatus("Vui lòng kết nối ví trước khi tạo sản phẩm.");
      return;
    }

    const formData = new FormData();
    const productName = name.trim();
    const productOrigin = origin.trim();
    const productId = crypto.randomUUID();
    const statusOnChain = "PLANTED";

    try {
      setIsSubmitting(true);
      setStatus("Vui lòng xác nhận giao dịch tạo sản phẩm trên MetaMask...");

      const hashValue = await buildProductHash(productName, productOrigin, statusOnChain);
      const txHash = await addProductOnChain(productId, hashValue);

      formData.append("id", productId);
      formData.append("name", productName);
      formData.append("origin", productOrigin);
      formData.append("wallet", wallet);
      formData.append("tx_hash", txHash);
      formData.append("image", image);

      setStatus("Đang đồng bộ dữ liệu về backend...");

      const response = await API.post("/create/", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      const createdProductId = response?.data?.id || productId;
      setStatus(`Tạo sản phẩm thành công. Product ID: ${createdProductId}`);
      navigate(`/product/${createdProductId}`);
    } catch (error) {
      if (!error?.response) {
        setStatus(getReadableWalletError(error, "Không kết nối được backend. Hãy chạy Django server và thử lại."));
      } else {
        setStatus(error?.response?.data?.detail || error?.message || "Tạo sản phẩm thất bại.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="create-page">
      <div className="create-shell">
        <section className="create-card">
          <div className="header-row">
            <h1 className="title">Tạo Nông Sản</h1>
            <span className="wallet-pill">Wallet: {shortWallet}</span>
          </div>

          <p className="sub">Đăng ký sản phẩm mới với thông tin xuất xứ và ảnh minh chứng để bắt đầu hành trình truy xuất.</p>

          <form onSubmit={handleSubmit}>
            <div className="row">
              <label className="field">
                <span className="label">Tên nông sản:</span>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="VD: Green Tea Leaves"
                />
              </label>

              <label className="field">
                <span className="label">Nguồn gốc:</span>
                <input
                  className="input"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="VD: Lam Dong, Vietnam"
                />
              </label>

              <div className="field full">
                <span className="label">Ảnh nông sản:</span>
                <div
                  className={`dropzone ${isDragging ? "active" : ""}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  <p className="dropzone-title">Kéo thả ảnh vào đây hoặc bấm để chọn file</p>
                  <p className="dropzone-sub">Hỗ trợ định dạng ảnh phổ biến: JPG, PNG, WEBP.</p>
                  <p className="dropzone-file">{image ? `Đã chọn: ${image.name}` : "Chưa chọn ảnh nào"}</p>

                  {previewUrl && (
                    <div className="image-preview-wrap">
                      <img className="image-preview" src={previewUrl} alt="Ảnh xem trước nông sản" />
                    </div>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(event) => onSelectImageFile(event.target.files?.[0] || null)}
                />
              </div>
            </div>

            <div className="message">{status}</div>

            <div className="actions">
              <Link className="btn btn-ghost" to="/">
                Về trang chủ
              </Link>
              {!wallet && (
                <button className="btn btn-ghost" type="button" onClick={connectWallet} disabled={isConnecting}>
                  {isConnecting ? "Đang kết nối..." : "Connect Wallet"}
                </button>
              )}
              <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Đang tạo..." : "Tạo sản phẩm"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
