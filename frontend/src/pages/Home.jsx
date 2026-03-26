import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import API from "../services/api";
import "../assets/homeProductPages.css";
import {
  connectWalletWithEthers,
  getConnectedWalletWithEthers,
  subscribeWalletChanges,
  WALLET_STORAGE_KEY,
} from "../services/wallet";

export default function Home() {
  const [wallet, setWallet] = useState("");
  const [status, setStatus] = useState("Sẵn sàng kết nối ví để bắt đầu truy xuất nguồn gốc.");
  const [isConnecting, setIsConnecting] = useState(false);
  const [products, setProducts] = useState([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productsError, setProductsError] = useState("");

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
      setStatus(error?.message || "Kết nối thất bại, vui lòng thử lại.");
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setWallet("");
    setProducts([]);
    setProductsError("");
    localStorage.removeItem(WALLET_STORAGE_KEY);
    setStatus("Đã ngắt kết nối trong ứng dụng. Nếu muốn thu hồi quyền hoàn toàn, hãy ngắt trong MetaMask.");
  };

  useEffect(() => {
    const syncWalletFromMetaMask = async () => {
      try {
        const account = await getConnectedWalletWithEthers();

        if (account) {
          setWallet(account);
          localStorage.setItem(WALLET_STORAGE_KEY, account);
          setStatus("Đã kết nối ví MetaMask.");
          return;
        }

        setWallet("");
        localStorage.removeItem(WALLET_STORAGE_KEY);
      } catch (_error) {
        const cachedWallet = localStorage.getItem(WALLET_STORAGE_KEY);
        if (cachedWallet) {
          setWallet(cachedWallet);
        }
      }
    };

    const unsubscribe = subscribeWalletChanges((account) => {
      if (account) {
        setWallet(account);
        localStorage.setItem(WALLET_STORAGE_KEY, account);
        setStatus("Đã cập nhật ví MetaMask.");
      } else {
        setWallet("");
        localStorage.removeItem(WALLET_STORAGE_KEY);
        setStatus("MetaMask đã ngắt kết nối. Vui lòng kết nối lại để tiếp tục.");
      }
    });

    syncWalletFromMetaMask();

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const fetchWalletProducts = async () => {
      if (!wallet) {
        setProducts([]);
        setProductsError("");
        return;
      }

      try {
        setIsLoadingProducts(true);
        setProductsError("");
        const response = await API.get("/products/", {
          params: { wallet },
        });
        setProducts(response.data?.products || []);
      } catch (error) {
        if (!error?.response) {
          setProductsError("Không kết nối được backend. Kiểm tra server Django đang chạy tại 127.0.0.1:8000.");
        } else {
          setProductsError(error?.response?.data?.detail || "Không tải được danh sách sản phẩm.");
        }
      } finally {
        setIsLoadingProducts(false);
      }
    };

    fetchWalletProducts();
  }, [wallet]);

  const toImageUrl = (imagePath) => {
    if (!imagePath) return "";
    try {
      return new URL(imagePath, API.defaults.baseURL).toString();
    } catch (_e) {
      return imagePath;
    }
  };

  return (
    <div className="home-page">
      <div className="home-shell">
        <span className="brand-chip">Farm to Table Visibility</span>

        <section className="hero">
          <article className="panel">
            <h1>Agri Trace Platform</h1>
            <p>
              Theo dõi toàn bộ vòng đời nông sản từ thu hoạch, vận chuyển đến điểm bán với dữ liệu minh bạch trên blockchain.
            </p>

            <div className="cta-row">
              {!wallet && (
                <button className="btn btn-primary" onClick={connectWallet} disabled={isConnecting}>
                  {isConnecting ? "Đang kết nối..." : "Kết nối MetaMask"}
                </button>
              )}

              {wallet && (
                <button className="btn btn-danger" type="button" onClick={disconnectWallet}>
                  Ngắt kết nối
                </button>
              )}

              {wallet && (
                <Link className="btn btn-secondary" to="/create">
                  Tạo sản phẩm mới
                </Link>
              )}
            </div>

            <div className="status-box">{status}</div>
          </article>

          <article className="panel wallet-card">
            <div className="wallet-content">
              <p className="wallet-title">Wallet</p>
              <p className="wallet-address">{shortWallet}</p>
              <p className="wallet-sub">
                Địa chỉ ví được dùng để ký giao dịch và xác thực mọi thao tác ghi nhận hành trình sản phẩm.
              </p>
            </div>
          </article>
        </section>

        <section className="feature-grid">
          <article className="feature">
            <h3>Minh bạch</h3>
            <p>Dữ liệu truy xuất không thể chỉnh sửa sau khi đã ghi lên blockchain.</p>
          </article>
          <article className="feature">
            <h3>Nhanh gọn</h3>
            <p>Tạo sản phẩm, cập nhật trạng thái và tra cứu thông tin chỉ trong vài bước.</p>
          </article>
          <article className="feature">
            <h3>Đáng tin</h3>
            <p>Người mua kiểm tra lịch sử hàng hóa tức thì bằng mã sản phẩm duy nhất.</p>
          </article>
        </section>

        <section className="product-section panel">
          <div className="product-head">
            <div>
              <h2 className="product-title">Nông sản của bạn</h2>
              <p className="product-note">Sau khi kết nối MetaMask, hệ thống sẽ hiển thị các sản phẩm thuộc địa chỉ này.</p>
            </div>
            <span className="wallet-inline">{shortWallet}</span>
          </div>

          {!wallet && <div className="product-feedback">Hãy kết nối MetaMask để xem danh sách sản phẩm của bạn.</div>}
          {wallet && isLoadingProducts && <div className="product-feedback">Đang tải danh sách sản phẩm...</div>}
          {wallet && productsError && <div className="product-feedback error">{productsError}</div>}

          {wallet && !isLoadingProducts && !productsError && products.length === 0 && (
            <div className="product-feedback">Ví này chưa có sản phẩm nào. Bạn có thể tạo sản phẩm mới ngay bây giờ.</div>
          )}

          {wallet && !isLoadingProducts && !productsError && products.length > 0 && (
            <div className="product-list">
              {products.map((item) => (
                <Link key={item.id} className="product-item" to={`/product/${item.id}`}>
                  {item.latest_version?.image && (
                    <img
                      className="product-img"
                      src={toImageUrl(item.latest_version.image)}
                      alt={`Product ${item.name}`}
                    />
                  )}
                  <h3 className="product-name">{item.name}</h3>
                  <p className="product-meta">Origin: {item.origin}</p>
                  <span className="product-badge">{item.latest_version?.status || "NO STATUS"}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}