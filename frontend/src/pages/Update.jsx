import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import API from "../services/api";
import "../assets/formPages.css";
import {
  buildProductHash,
  connectWalletWithEthers,
  getReadableWalletError,
  updateProductOnChain,
  WALLET_STORAGE_KEY,
} from "../services/wallet";

const STATUS_OPTIONS = ["PLANTED", "HARVESTED", "PACKAGED", "SHIPPED", "DELIVERED", "SOLD"];

export default function Update() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const isProductIdLocked = Boolean(routeId);
  const fileInputRef = useRef(null);

  const [productId, setProductId] = useState(routeId || "");
  const [status, setStatus] = useState(STATUS_OPTIONS[0]);
  const [location, setLocation] = useState("");
  const [temperatureC, setTemperatureC] = useState("");
  const [humidityPercent, setHumidityPercent] = useState("");
  const [note, setNote] = useState("");
  const [image, setImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("Nhập thông tin cập nhật và tải ảnh mới cho phiên bản tiếp theo.");
  const [wallet, setWallet] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const titleId = useMemo(() => {
    if (!productId) return "N/A";
    return productId;
  }, [productId]);

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

  const connectWallet = async () => {
    try {
      setIsConnecting(true);
      setMessage("Đang mở MetaMask...");
      const account = await connectWalletWithEthers();
      setWallet(account);
      localStorage.setItem(WALLET_STORAGE_KEY, account);
      setMessage("Kết nối ví thành công.");
    } catch (error) {
      setMessage(getReadableWalletError(error, "Kết nối ví thất bại. Vui lòng thử lại."));
    } finally {
      setIsConnecting(false);
    }
  };

  const onSelectImageFile = (file) => {
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      setMessage("File không hợp lệ. Vui lòng chọn ảnh (jpg, png, webp...).");
      return;
    }
    setImage(file);
    setMessage("Đã chọn ảnh phiên bản mới.");
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

    if (!productId.trim()) {
      setMessage("Vui lòng nhập Product ID.");
      return;
    }

    if (!image) {
      setMessage("Vui lòng chọn ảnh phiên bản mới.");
      return;
    }

    if (!wallet) {
      setMessage("Vui lòng kết nối ví trước khi cập nhật sản phẩm.");
      return;
    }

    const formData = new FormData();
    const normalizedId = productId.trim();
    const normalizedLocation = location.trim();
    const normalizedTemperatureC = temperatureC.trim();
    const normalizedHumidityPercent = humidityPercent.trim();
    const normalizedNote = note.trim();

    try {
      setIsSubmitting(true);
      setMessage("Vui lòng xác nhận giao dịch cập nhật trên MetaMask...");

      const productResponse = await API.get(`/product/${normalizedId}/`);
      const productName = productResponse?.data?.product?.name || "";
      const productOrigin = productResponse?.data?.product?.origin || "";
      const hashValue = await buildProductHash(productName, productOrigin, status);
      const txHash = await updateProductOnChain(normalizedId, hashValue);

      formData.append("id", normalizedId);
      formData.append("status", status);
      formData.append("location", normalizedLocation);
      formData.append("temperature_c", normalizedTemperatureC);
      formData.append("humidity_percent", normalizedHumidityPercent);
      formData.append("note", normalizedNote);
      formData.append("wallet", wallet);
      formData.append("tx_hash", txHash);
      formData.append("image", image);

      setMessage("Đang đồng bộ dữ liệu về backend...");

      await API.post("/update/", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      setMessage("Cập nhật sản phẩm thành công.");
      setImage(null);
      navigate(`/product/${normalizedId}`);
    } catch (error) {
      if (!error?.response) {
        setMessage(getReadableWalletError(error, "Không kết nối được backend. Hãy kiểm tra Django server."));
      } else {
        setMessage(error?.response?.data?.detail || "Cập nhật thất bại.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="update-page">
      <div className="update-shell">
        <section className="update-card">
          <div className="header-row">
            <h1 className="title">Cập Nhật Nông Sản</h1>
            <span className="id-pill">Product ID: #{titleId}</span>
          </div>

          <p className="sub">Thêm phiên bản mới với trạng thái mới và ảnh minh chứng để tiếp tục hành trình truy xuất.</p>

          <form onSubmit={handleSubmit}>
            <div className="row">
              <label className="field">
                <span className="label">Mã nông sản:</span>
                <input
                  className="input"
                  value={productId}
                  onChange={(event) => setProductId(event.target.value)}
                  placeholder="VD: 1"
                  disabled={isProductIdLocked}
                />
              </label>

              <label className="field">
                <span className="label">Trạng thái:</span>
                <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
                  {STATUS_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="label">Vị trí hiện tại:</span>
                <input
                  className="input"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="VD: Kho lạnh số 2 - Bình Dương"
                />
              </label>

              <label className="field">
                <span className="label">Nhiệt độ (°C):</span>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  value={temperatureC}
                  onChange={(event) => setTemperatureC(event.target.value)}
                  placeholder="VD: 5.8"
                />
              </label>

              <label className="field">
                <span className="label">Độ ẩm (%):</span>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={humidityPercent}
                  onChange={(event) => setHumidityPercent(event.target.value)}
                  placeholder="VD: 72"
                />
              </label>

              <label className="field full">
                <span className="label">Ghi chú cập nhật:</span>
                <input
                  className="input"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="VD: Đã đóng gói, chuẩn bị chuyển kho"
                />
              </label>

              <div className="field full">
                <span className="label">Ảnh tiến trình:</span>
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
                      <img className="image-preview" src={previewUrl} alt="Ảnh xem trước phiên bản" />
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

            <div className="message">{message}</div>

            <div className="actions">
              <Link className="btn btn-ghost" to="/">
                Về trang chủ
              </Link>
              {!wallet && (
                <button className="btn btn-ghost" type="button" onClick={connectWallet} disabled={isConnecting}>
                  {isConnecting ? "Đang kết nối..." : "Connect Wallet"}
                </button>
              )}
              {productId && (
                <Link className="btn btn-ghost" to={`/product/${productId}`}>
                  Xem chi tiết sản phẩm
                </Link>
              )}
              <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Đang cập nhật..." : "Update Product"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
