# Execution Flow

## 1) Ket noi MetaMask
- Frontend connect button:
  - [frontend/src/pages/Home.jsx](frontend/src/pages/Home.jsx#L48)
  - [frontend/src/pages/Create.jsx](frontend/src/pages/Create.jsx#L44)
  - [frontend/src/pages/Update.jsx](frontend/src/pages/Update.jsx#L76)
- Ham ket noi vi:
  - [frontend/src/services/wallet.js](frontend/src/services/wallet.js#L187) `connectWalletWithEthers`
- Xu ly loi MetaMask:
  - [frontend/src/services/wallet.js](frontend/src/services/wallet.js#L126) `getReadableWalletError`

## 2) Tao san pham (Create)
- Validate + submit form:
  - [frontend/src/pages/Create.jsx](frontend/src/pages/Create.jsx#L110) `handleSubmit`
- Tinh hash:
  - [frontend/src/services/wallet.js](frontend/src/services/wallet.js#L157) `buildProductHash`
  - [frontend/src/services/wallet.js](frontend/src/services/wallet.js#L164) `buildImageFileHash`
- Ghi blockchain:
  - [frontend/src/services/wallet.js](frontend/src/services/wallet.js#L171) `addProductOnChain`
- API backend:
  - [backend/products/views.py](backend/products/views.py#L523) `create_product`
- Build hash backend:
  - [backend/products/views.py](backend/products/views.py#L484) `build_business_hash`
- Verify tx backend:
  - [backend/products/views.py](backend/products/views.py#L127) `verify_contract_tx`

Flow nhanh:
1. Frontend validate form
2. Frontend tinh hash + goi addProduct on-chain
3. Frontend gui tx_hash + data + image ve backend
4. Backend verify tx + on-chain state + luu Product/ProductVersion

## 3) Cap nhat san pham (Update)
- Validate + submit form:
  - [frontend/src/pages/Update.jsx](frontend/src/pages/Update.jsx#L119) `handleSubmit`
- Ghi blockchain:
  - [frontend/src/services/wallet.js](frontend/src/services/wallet.js#L179) `updateProductOnChain`
- API backend:
  - [backend/products/views.py](backend/products/views.py#L633) `update_product`
- Verify tx backend:
  - [backend/products/views.py](backend/products/views.py#L127) `verify_contract_tx`

Flow nhanh:
1. Frontend lay product hien tai de tinh `nextVersion`
2. Frontend tinh hash update + goi updateProduct on-chain
3. Frontend gui tx_hash + image + form ve backend
4. Backend verify owner + verify tx + luu ProductVersion moi

## 4) Xem chi tiet va verify tamper
- Lay du lieu product + verify song song:
  - [frontend/src/pages/Product.jsx](frontend/src/pages/Product.jsx#L75) `fetchProduct`
- Map version bi loi:
  - [frontend/src/pages/Product.jsx](frontend/src/pages/Product.jsx#L52) `tamperedVersionMap`
- Dem violated dung theo product hien tai:
  - [frontend/src/pages/Product.jsx](frontend/src/pages/Product.jsx#L66) `violatedCount`
- API chi tiet:
  - [backend/products/views.py](backend/products/views.py#L734) `get_product`
- API verify:
  - [backend/products/views.py](backend/products/views.py#L860) `verify_product_versions_view`
- Verify tung version:
  - [backend/products/views.py](backend/products/views.py#L285) `verify_product_versions`
  - [backend/products/views.py](backend/products/views.py#L158) `verify_product_version_onchain`

Flow nhanh:
1. Frontend goi 2 API: detail + verify
2. Backend verify tx/hash theo tung version
3. Frontend hien canh bao integrity neu co version loi

## 5) Danh sach san pham (Home)
- Fetch list theo wallet/search/status/page:
  - [frontend/src/pages/Home.jsx](frontend/src/pages/Home.jsx#L129) `fetchWalletProducts`
- API danh sach:
  - [backend/products/views.py](backend/products/views.py#L770) `get_products_by_wallet`

Flow nhanh:
1. Frontend gui query params (wallet, search, status, page)
2. Backend filter + paginate + tra ve latest_version moi product

## 6) Rule hash can nho
- Thu tu field hash:
  - [frontend/src/services/wallet.js](frontend/src/services/wallet.js#L7)
  - [backend/products/views.py](backend/products/views.py#L27)
- Canonical + normalize frontend:
  - [frontend/src/services/wallet.js](frontend/src/services/wallet.js#L101)
- Canonical + normalize backend:
  - [backend/products/views.py](backend/products/views.py#L455)

## 7) Endpoint map nhanh
- POST /create/ -> [backend/products/views.py](backend/products/views.py#L523)
- POST /update/ -> [backend/products/views.py](backend/products/views.py#L633)
- GET /product/{id}/ -> [backend/products/views.py](backend/products/views.py#L734)
- GET /product/{id}/verify/ -> [backend/products/views.py](backend/products/views.py#L860)
- GET /products/ -> [backend/products/views.py](backend/products/views.py#L770)


