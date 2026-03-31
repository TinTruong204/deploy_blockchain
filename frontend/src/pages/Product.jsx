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
        map.set(item.version, item.warning || item.reason || "Integrity check failed.");
      }
    });

    return map;
  }, [integrity]);

  const violatedCount = integrity?.violated_versions?.length || 0;

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
        console.warn("Could not get connected wallet:", walletError);
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
    if (!value) return "N/A";
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
    if (!value) return "N/A";
    if (value.length <= 22) return value;
    return `${value.slice(0, 12)}...${value.slice(-8)}`;
  };

  const shortenWallet = (value) => {
    if (!value) return "N/A";
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
        <div className="top-row">
          <div className="title-wrap">
            <span className="trace-chip">Trace Detail</span>
            <h1 className="title">{data?.product?.name || "Product Trace"}</h1>
            <p className="title-sub">Toàn bộ hành trình của nông sản được cập nhật theo từng phiên bản.</p>
          </div>

          <div className="top-actions">
            <span className="id-tag">Product ID: #{id}</span>
            <Link className="btn-link" to="/">
              Về trang chủ
            </Link>
            {isOwner && (
              <> 
                <Link className="btn-link" to={`/update/${id}`}>
                  Cập nhật sản phẩm
                </Link>
              </>
            )}
          </div>
        </div>

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

            <section className="grid">
            <article className="card">
              <div className="insight-grid">
                <div className="insight-item">
                  <p className="insight-label">Trạng thái mới nhất</p>
                  <p className="insight-value">{latestVersion?.status || "N/A"}</p>
                </div>
                <div className="insight-item">
                  <p className="insight-label">Tổng phiên bản</p>
                  <p className="insight-value">{versionCount}</p>
                </div>
                <div className="insight-item">
                  <p className="insight-label">Cập nhật gần nhất</p>
                  <p className="insight-value">{formatDateTime(latestRecordedAt)}</p>
                </div>
              </div>

              <h2 className="section-title">Thông tin chung</h2>
              <div className="kv">
                <div className="kv-item">
                  <p className="kv-label">Tên nông sản:</p>
                  <p className="kv-value">{data.product?.name || "N/A"}</p>
                </div>
                <div className="kv-item">
                  <p className="kv-label">Xuất xứ:</p>
                  <p className="kv-value">{data.product?.origin || "N/A"}</p>
                </div>
                <div className="kv-item">
                  <p className="kv-label">Trạng thái hiện tại:</p>
                  <p className="kv-value">{latestVersion?.status || "N/A"}</p>
                </div>
                <div className="kv-item">
                  <p className="kv-label">Mã lô:</p>
                  <p className="kv-value">{data.product?.batch_code || "N/A"}</p>
                </div>
                <div className="kv-item">
                  <p className="kv-label">Khu vực trồng:</p>
                  <p className="kv-value">{data.product?.planting_area || "N/A"}</p>
                </div>
                <div className="kv-item">
                  <p className="kv-label">Nhà cung cấp:</p>
                  <p className="kv-value">{data.product?.supplier_name || "N/A"}</p>
                </div>
                <div className="kv-item">
                  <p className="kv-label">Ví sở hữu:</p>
                  <p className="kv-value" title={data.product?.owner_wallet || ""}>
                    {shortenWallet(data.product?.owner_wallet)}
                  </p>
                </div>
              </div>

              {isOwner && (
                <section className="qr-card">
                  <h3 className="qr-head">QR Truy Xuất Nguồn Gốc</h3>
                  <p className="qr-sub">In mã này và dán lên sản phẩm. Người dùng quét sẽ mở trang thông tin chi tiết.</p>

                  <div className="qr-layout">
                    <div className="qr-box">
                      {qrImageUrl && <img className="qr-image" src={qrImageUrl} alt={`QR truy xuất sản phẩm ${id}`} />}
                    </div>

                    <div className="qr-details">
                      <p className="qr-url">{traceUrl}</p>
                      <div className="qr-actions">
                        <button className="qr-btn" type="button" onClick={downloadQr}>
                          Tải QR
                        </button>
                        <button className="qr-btn" type="button" onClick={printTraceQr}>
                          In QR
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </article>

            <article className="card">
              <h2 className="section-title">Lịch sử phiên bản</h2>

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
                        <span>{version.location || "N/A"}</span>
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
                            <p className="metric-value">{version.temperature_c ?? "N/A"} C</p>
                          </div>
                          <div className="metric-item">
                            <p className="metric-label">Độ ẩm</p>
                            <p className="metric-value">{version.humidity_percent ?? "N/A"}%</p>
                          </div>
                        </div>

                        <p className="note-line">{version.note || "Không có ghi chú cho phiên bản này."}</p>

                        <p className="mono" title={version.hash || ""}>Hash: {shortenHash(version.hash)}</p>
                        <p className="mono" title={version.tx_hash || ""}>Tx: {shortenHash(version.tx_hash)}</p>
                        {tamperReason && <p className="tamper-reason">{tamperReason}</p>}
                      </div>
                    </div>
                  )})}
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