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
  const STATUS_FILTER_OPTIONS = ["ALL", "PLANTED", "HARVESTED", "PACKAGED", "SHIPPED", "DELIVERED", "SOLD"];
  const [wallet, setWallet] = useState("");
  const [status, setStatus] = useState("Sẵn sàng kết nối ví để bắt đầu truy xuất nguồn gốc.");
  const [isConnecting, setIsConnecting] = useState(false);
  const [products, setProducts] = useState([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productsError, setProductsError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(9);
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: 9,
    total_items: 0,
    total_pages: 0,
    has_next: false,
    has_previous: false,
  });

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
    setPage(1);
    setSearch("");
    setStatusFilter("ALL");
    setPagination({
      page: 1,
      page_size: pageSize,
      total_items: 0,
      total_pages: 0,
      has_next: false,
      has_previous: false,
    });
    localStorage.removeItem(WALLET_STORAGE_KEY);
    setStatus("Đã ngắt kết nối trong ứng dụng. Nếu muốn thu hồi quyền hoàn toàn, hãy ngắt trong MetaMask.");
  };

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, pageSize]);

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

        const trimmedSearch = search.trim();
        const params = {
          wallet,
          page,
          page_size: pageSize,
        };

        if (trimmedSearch) {
          params.search = trimmedSearch;
        }

        if (statusFilter !== "ALL") {
          params.status = statusFilter;
        }

        const response = await API.get("/products/", {
          params,
        });

        const list = response?.data?.products || [];
        const pageInfo = response?.data?.pagination;

        setProducts(list);
        setPagination({
          page: pageInfo?.page ?? page,
          page_size: pageInfo?.page_size ?? pageSize,
          total_items: pageInfo?.total_items ?? list.length,
          total_pages: pageInfo?.total_pages ?? (list.length > 0 ? 1 : 0),
          has_next: pageInfo?.has_next ?? false,
          has_previous: pageInfo?.has_previous ?? false,
        });
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
  }, [wallet, search, statusFilter, page, pageSize]);

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

          {wallet && (
            <div className="product-controls">
              <label className="control-field search-field">
                <span>Tìm kiếm</span>
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Tìm theo tên hoặc nguồn gốc..."
                />
              </label>

              <label className="control-field">
                <span>Lọc trạng thái</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  {STATUS_FILTER_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="control-field">
                <span>Số mục/trang</span>
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                  <option value={6}>6</option>
                  <option value={9}>9</option>
                  <option value={12}>12</option>
                </select>
              </label>
            </div>
          )}

          {!wallet && <div className="product-feedback">Hãy kết nối MetaMask để xem danh sách sản phẩm của bạn.</div>}
          {wallet && isLoadingProducts && <div className="product-feedback">Đang tải danh sách sản phẩm...</div>}
          {wallet && productsError && <div className="product-feedback error">{productsError}</div>}

          {wallet && !isLoadingProducts && !productsError && products.length === 0 && (
            <div className="product-feedback">Ví này chưa có sản phẩm nào. Bạn có thể tạo sản phẩm mới ngay bây giờ.</div>
          )}

          {wallet && !isLoadingProducts && !productsError && products.length > 0 && (
            <>
              <div className="product-meta-row">
                <span>
                  Tổng: <strong>{pagination.total_items}</strong> sản phẩm
                </span>
                <span>
                  Trang <strong>{pagination.total_pages === 0 ? 0 : pagination.page}</strong>/{" "}
                  <strong>{pagination.total_pages}</strong>
                </span>
              </div>

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

              <div className="pagination-row">
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={!pagination.has_previous || isLoadingProducts}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  Trang trước
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={!pagination.has_next || isLoadingProducts}
                  onClick={() => setPage((prev) => prev + 1)}
                >
                  Trang sau
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}