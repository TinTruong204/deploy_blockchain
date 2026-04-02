import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import API from "../services/api";
import { getConnectedWalletWithEthers } from "../services/wallet";
import "../assets/homeProductPages.css";

export default function Product() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [integrity, setIntegrity] = useState(null);
  const [integrityLoading, setIntegrityLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentWallet, setCurrentWallet] = useState("");

  const latestVersion = useMemo(() => {
    if (!data?.versions?.length) return null;
    return data.versions[data.versions.length - 1];
  }, [data]);

  const isOwner = useMemo(() => {
    if (!currentWallet || !data?.product?.owner_wallet) return false;
    return currentWallet.toLowerCase() === data.product.owner_wallet.toLowerCase();
  }, [currentWallet, data]);

  const traceUrl = useMemo(() => {
    if (!id) return "";
    if (typeof window === "undefined") return `/#/product/${id}`;
    return `${window.location.origin}/#/product/${id}`;
  }, [id]);

  const qrImageUrl = useMemo(() => {
    if (!traceUrl) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(traceUrl)}`;
  }, [traceUrl]);

  const versionCount = data?.versions?.length || 0;

  const latestRecordedAt = useMemo(() => {
    return latestVersion?.created_at || data?.product?.created_at || "";
  }, [latestVersion, data]);

  const tamperedVersionMap = useMemo(() => {
    const map = new Map();
    const verifyResults = integrity?.results || [];

    verifyResults.forEach((item) => {
      if (item?.ok === false) {
        map.set(item.version, item.warning || item.reason || "Cảnh báo: dữ liệu không toàn vẹn.");
      }
    });

    return map;
  }, [integrity]);

  const violatedCount = useMemo(() => {
    if (!integrity?.violated_versions || !data?.versions) return 0;
    
    // Chỉ đếm những phiên bản bị violated thuộc sản phẩm hiện tại
    const currentVersionNumbers = new Set(data.versions.map(v => v.version));
    return integrity.violated_versions.filter(v => currentVersionNumbers.has(v)).length;
  }, [integrity, data]);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        setLoading(true);
        setError("");

        setIntegrityLoading(true);
        setIntegrity(null);

        const [productResponse, verifyResponse] = await Promise.allSettled([
          API.get(`/product/${id}/`),
          API.get(`/product/${id}/verify/`),
        ]);

        if (productResponse.status === "fulfilled") {
          setData(productResponse.value.data);
        } else {
          throw productResponse.reason;
        }

        if (verifyResponse.status === "fulfilled") {
          setIntegrity(verifyResponse.value.data);
        } else {
          setIntegrity(null);
        }
      } catch (fetchError) {
        setError(fetchError?.response?.data?.detail || "Không thể tải thông tin sản phẩm.");
      } finally {
        setIntegrityLoading(false);
        setLoading(false);
      }
    };

    const fetchCurrentWallet = async () => {
      try {
        const wallet = await getConnectedWalletWithEthers();
        setCurrentWallet(wallet || "");
      } catch (walletError) {
        console.warn("Không lấy được ví đang kết nối:", walletError);
        setCurrentWallet("");
      }
    };

    fetchProduct();
    fetchCurrentWallet();
  }, [id]);

  const toImageUrl = (imagePath) => {
    if (!imagePath) return "";
    if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
      return imagePath;
    }
    return imagePath.startsWith("/") ? imagePath : `/${imagePath}`;
  };

  const formatDateTime = (value) => {
    if (!value) return "Không có";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const shortenHash = (value) => {
    if (!value) return "Không có";
    if (value.length <= 22) return value;
    return `${value.slice(0, 12)}...${value.slice(-8)}`;
  };

  const shortenWallet = (value) => {
    if (!value) return "Không có";
    if (value.length <= 14) return value;
    return `${value.slice(0, 8)}...${value.slice(-4)}`;
  };

  const downloadQr = () => {
    if (!id || !qrImageUrl) return;
    const link = document.createElement("a");
    link.href = qrImageUrl;
    link.download = `product-${id}-qr.png`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.click();
  };

  const printTraceQr = () => {
    if (!id || !qrImageUrl) return;

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;

    const qrUrlForPrint = `${qrImageUrl}&_ts=${Date.now()}`;

    printWindow.document.write(`
      <html>
        <head>
          <title>In QR</title>
          <style>
            @page { margin: 8mm; }
            html, body {
              margin: 0;
              width: 100%;
              height: 100%;
              background: #ffffff;
            }
            body {
              display: grid;
              place-items: center;
            }
            #qr {
              width: 320px;
              height: 320px;
              object-fit: contain;
              display: block;
            }
          </style>
        </head>
        <body>
          <img id="qr" src="${qrUrlForPrint}" alt="QR truy xuất sản phẩm ${id}" />
          <script>
            (function () {
              var qr = document.getElementById("qr");
              if (!qr) return;

              qr.onload = function () {
                setTimeout(function () {
                  window.focus();
                  window.print();
                  window.close();
                }, 120);
              };

              qr.onerror = function () {
                alert("Khong tai duoc anh QR de in. Vui long thu lai.");
              };
            })();
          </script>
        </body>
      </html>
    `);

    printWindow.document.close();
  };

  return (
    <div className="product-page">
      <div className="product-shell">
        <section className="product-hero-v2">
          <div className="product-hero-main">
            <span className="product-chip-v2">Truy xuất nguồn gốc nông sản</span>
            <h1 className="product-title-v2">{data?.product?.name || "Nền tảng truy xuất nông sản"}</h1>
            <p className="product-sub-v2">
              Xem toàn bộ lịch sử của sản phẩm theo từng phiên bản với thông tin xác thực và dữ liệu kiểm chứng.
            </p>
          </div>

          <div className="product-hero-actions-v2">
            <span className="product-id-v2">Mã sản phẩm: #{id}</span>
            <div className="product-action-row-v2">
              <Link className="product-btn-v2 product-btn-soft-v2 product-hero-btn-v2" to="/">
                Về trang chủ
              </Link>
              {isOwner && (
                <Link className="product-btn-v2 product-btn-strong-v2 product-hero-btn-v2" to={`/update/${id}`}>
                  Cập nhật thông tin
                </Link>
              )}
            </div>
          </div>
        </section>

        {loading && <div className="loading">Đang tải thông tin sản phẩm...</div>}
        {error && !loading && <div className="error">{error}</div>}

        {!loading && !error && data && (
          <>
            {integrityLoading ? (
              <div className="integrity-info">Đang kiểm tra tính toàn vẹn dữ liệu với blockchain...</div>
            ) : integrity?.is_safe === false ? (
              <div className="integrity-alert">
                Cảnh báo: phát hiện {violatedCount} phiên bản có dấu hiệu bị sửa dữ liệu hoặc không khớp blockchain.
              </div>
            ) : integrity?.is_safe === true ? (
              <></>
            ) : (
              <div className="integrity-info">Không thể lấy trạng thái kiểm tra integrity ở thời điểm hiện tại.</div>
            )}

            <section className="product-layout-v2">
              <article className="product-panel-v2 product-panel-info-v2">
                <div className="product-summary-v2">
                  <div className="product-summary-item-v2">
                    <p className="product-summary-label-v2">Trạng thái mới nhất</p>
                    <p className="product-summary-value-v2">{latestVersion?.status || "Không có"}</p>
                  </div>
                  <div className="product-summary-item-v2">
                    <p className="product-summary-label-v2">Tổng phiên bản</p>
                    <p className="product-summary-value-v2">{versionCount}</p>
                  </div>
                  <div className="product-summary-item-v2">
                    <p className="product-summary-label-v2">Cập nhật gần nhất</p>
                    <p className="product-summary-value-v2">{formatDateTime(latestRecordedAt)}</p>
                  </div>
                </div>

                <h2 className="product-section-title-v2">Thông tin chung</h2>
                <div className="product-facts-v2">
                  <div className="product-fact-v2">
                    <p className="product-fact-label-v2">Tên nông sản</p>
                    <p className="product-fact-value-v2">{data.product?.name || "Không có"}</p>
                  </div>
                  <div className="product-fact-v2">
                    <p className="product-fact-label-v2">Xuất xứ</p>
                    <p className="product-fact-value-v2">{data.product?.origin || "Không có"}</p>
                  </div>
                  <div className="product-fact-v2">
                    <p className="product-fact-label-v2">Trạng thái hiện tại</p>
                    <p className="product-fact-value-v2">{latestVersion?.status || "Không có"}</p>
                  </div>
                  <div className="product-fact-v2">
                    <p className="product-fact-label-v2">Mã lô</p>
                    <p className="product-fact-value-v2">{data.product?.batch_code || "Không có"}</p>
                  </div>
                  <div className="product-fact-v2">
                    <p className="product-fact-label-v2">Khu vực trồng</p>
                    <p className="product-fact-value-v2">{data.product?.planting_area || "Không có"}</p>
                  </div>
                  <div className="product-fact-v2">
                    <p className="product-fact-label-v2">Nhà cung cấp</p>
                    <p className="product-fact-value-v2">{data.product?.supplier_name || "Không có"}</p>
                  </div>
                  <div className="product-fact-v2 product-fact-full-v2">
                    <p className="product-fact-label-v2">Ví sở hữu</p>
                    <p className="product-fact-value-v2" title={data.product?.owner_wallet || ""}>
                      {shortenWallet(data.product?.owner_wallet)}
                    </p>
                  </div>
                </div>

                {isOwner && (
                  <section className="product-qr-v2">
                    <h3 className="product-qr-title-v2">QR truy xuất nguồn gốc</h3>
                    <p className="product-qr-sub-v2">
                      In mã này và dán lên sản phẩm. Người dùng quét sẽ mở trực tiếp trang thông tin chi tiết.
                    </p>

                    <div className="product-qr-layout-v2">
                      <div className="product-qr-box-v2">
                        {qrImageUrl && <img className="product-qr-image-v2" src={qrImageUrl} alt={`QR truy xuất sản phẩm ${id}`} />}
                      </div>

                      <div className="product-qr-details-v2">
                        <p className="product-qr-url-v2">{traceUrl}</p>
                        <div className="product-qr-actions-v2">
                          <button className="product-btn-v2 product-btn-soft-v2" type="button" onClick={downloadQr}>
                            Tải QR
                          </button>
                          <button className="product-btn-v2 product-btn-strong-v2" type="button" onClick={printTraceQr}>
                            In QR
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </article>

              <article className="product-panel-v2">
                <div className="product-timeline-head-v2">
                  <h2 className="product-section-title-v2">Lịch sử phiên bản</h2>
                  <p className="product-timeline-sub-v2">Mỗi bản ghi là một mốc hành trình đã được lưu trữ.</p>
                </div>

                {!data.versions?.length ? (
                  <div className="empty">Chưa có phiên bản nào cho sản phẩm này.</div>
                ) : (
                  <div className="timeline">
                    {data.versions.map((version) => {
                      const tamperReason = tamperedVersionMap.get(version.version);

                      return (
                        <div className={`timeline-item ${tamperReason ? "timeline-item-alert" : ""}`} key={version.version}>
                          <div className="timeline-head">
                            <strong>Version {version.version}</strong>
                            <div className="timeline-head-right">
                              {tamperReason && <span className="tamper-pill">Canh bao integrity</span>}
                              <span className="status-pill">{version.status}</span>
                            </div>
                          </div>

                          <div className="timeline-meta">
                            <span>{formatDateTime(version.created_at)}</span>
                            <span>{version.location || "Không có"}</span>
                          </div>

                          <div className="timeline-body">
                            {version.image && (
                              <img
                                className="preview"
                                src={toImageUrl(version.image)}
                                alt={`Product version ${version.version}`}
                              />
                            )}

                            <div className="metric-grid">
                              <div className="metric-item">
                                <p className="metric-label">Nhiệt độ</p>
                                <p className="metric-value">{version.temperature_c ?? "Không có"} C</p>
                              </div>
                              <div className="metric-item">
                                <p className="metric-label">Độ ẩm</p>
                                <p className="metric-value">{version.humidity_percent ?? "Không có"}%</p>
                              </div>
                            </div>

                            <p className="note-line">{version.note || "Không có ghi chú cho phiên bản này."}</p>

                            <p className="mono" title={version.hash || ""}>Hash: {shortenHash(version.hash)}</p>
                            <a
                              className="mono"
                              href={version.tx_hash ? `https://coston2-explorer.flare.network/tx/${version.tx_hash}` : "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={version.tx_hash || ""}
                              style={{
                                textDecoration: "none",
                                color: "inherit",
                                cursor: version.tx_hash ? "pointer" : "default",
                              }}
                            >
                              Tx: {shortenHash(version.tx_hash)}
                            </a>
                            {tamperReason && <p className="tamper-reason">{tamperReason}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            </section>
          </>
        )}
      </div>
    </div>
  );
}