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
  const [batchCode, setBatchCode] = useState("");
  const [plantingArea, setPlantingArea] = useState("");
  const [harvestDate, setHarvestDate] = useState("");
  const [quantityKg, setQuantityKg] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [location, setLocation] = useState("");
  const [temperatureC, setTemperatureC] = useState("");
  const [humidityPercent, setHumidityPercent] = useState("");
  const [note, setNote] = useState("");
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
    const normalizedBatchCode = batchCode.trim();
    const normalizedPlantingArea = plantingArea.trim();
    const normalizedHarvestDate = harvestDate.trim();
    const normalizedQuantityKg = quantityKg.trim();
    const normalizedSupplierName = supplierName.trim();
    const normalizedLocation = location.trim();
    const normalizedTemperatureC = temperatureC.trim();
    const normalizedHumidityPercent = humidityPercent.trim();
    const normalizedNote = note.trim();
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
      formData.append("batch_code", normalizedBatchCode);
      formData.append("planting_area", normalizedPlantingArea);
      formData.append("harvest_date", normalizedHarvestDate);
      formData.append("quantity_kg", normalizedQuantityKg);
      formData.append("supplier_name", normalizedSupplierName);
      formData.append("location", normalizedLocation);
      formData.append("temperature_c", normalizedTemperatureC);
      formData.append("humidity_percent", normalizedHumidityPercent);
      formData.append("note", normalizedNote);
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

              <label className="field">
                <span className="label">Mã lô (Batch Code):</span>
                <input
                  className="input"
                  value={batchCode}
                  onChange={(e) => setBatchCode(e.target.value)}
                  placeholder="VD: TEA-2026-001"
                />
              </label>

              <label className="field">
                <span className="label">Khu vực trồng:</span>
                <input
                  className="input"
                  value={plantingArea}
                  onChange={(e) => setPlantingArea(e.target.value)}
                  placeholder="VD: Khu A - Đồi 3"
                />
              </label>

              <label className="field">
                <span className="label">Ngày thu hoạch:</span>
                <input className="input" type="date" value={harvestDate} onChange={(e) => setHarvestDate(e.target.value)} />
              </label>

              <label className="field">
                <span className="label">Sản lượng (kg):</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={quantityKg}
                  onChange={(e) => setQuantityKg(e.target.value)}
                  placeholder="VD: 1200"
                />
              </label>

              <label className="field">
                <span className="label">Nhà cung cấp:</span>
                <input
                  className="input"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="VD: HTX Nông sản Xanh"
                />
              </label>

              <label className="field">
                <span className="label">Vị trí hiện tại:</span>
                <input
                  className="input"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="VD: Kho trung chuyển Đà Lạt"
                />
              </label>

              <label className="field">
                <span className="label">Nhiệt độ (°C):</span>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  value={temperatureC}
                  onChange={(e) => setTemperatureC(e.target.value)}
                  placeholder="VD: 6.5"
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
                  onChange={(e) => setHumidityPercent(e.target.value)}
                  placeholder="VD: 74"
                />
              </label>

              <label className="field full">
                <span className="label">Ghi chú quản lý:</span>
                <input
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="VD: Thu hoạch đợt đầu, chất lượng loại 1"
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
