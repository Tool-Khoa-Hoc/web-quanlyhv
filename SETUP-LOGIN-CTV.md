# Đăng nhập cộng tác viên bằng Google nội bộ

Tài liệu này hướng dẫn bật tính năng: cộng tác viên (CTV) đăng nhập bằng tài
khoản Google nội bộ `@dautruonghoctap.io.vn` và chỉ thấy/quản lý các Google
Group mà họ **được thêm làm thành viên**.

## Cơ chế tóm tắt

- **Đăng nhập:** Google OAuth, giới hạn domain `dautruonghoctap.io.vn`. Tài
  khoản ngoài domain bị từ chối ngay ở bước callback.
- **Phiên:** cookie `dth_session` ký bằng HMAC-SHA256 (`APP_SESSION_SECRET`),
  hết hạn sau 12 giờ.
- **Vai trò:**
  - **Admin** = email impersonate (`GOOGLE_ADMIN_IMPERSONATE_EMAIL`) + các email
    trong `APP_ADMIN_EMAILS`. Thấy toàn bộ app.
  - **CTV** = tài khoản domain còn lại, nhưng phải được cấp quyền qua
    `CTV_ACCESS_GROUP_EMAIL` hoặc `APP_CTV_EMAILS`. Chỉ thấy trang "Nhóm của tôi".
- **Cấp quyền CTV nhanh = thêm CTV vào Google Group cấp quyền.** App kiểm tra
  membership của nhóm `CTV_ACCESS_GROUP_EMAIL` khi đăng nhập và khi gọi API.
- **Quyền thao tác nhóm học thử:** CTV chỉ được xem/thêm thành viên `MEMBER`
  trong nhóm `CTV_TRIAL_GROUP_EMAIL`. Admin vẫn có toàn quyền mọi nhóm.

> Để rút quyền một CTV, chỉ cần xóa họ khỏi nhóm `CTV_ACCESS_GROUP_EMAIL`.
> Nếu đang dùng `APP_CTV_EMAILS` kiểu cũ thì cần xóa email khỏi biến môi trường.

## Bước 1 — Tạo OAuth Client ID

1. Vào [Google Cloud Console](https://console.cloud.google.com/) → đúng project
   chứa Service Account hiện tại.
2. **APIs & Services → OAuth consent screen**: chọn **Internal** (chỉ cho user
   trong tổ chức), điền tên app + email hỗ trợ, lưu.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized redirect URIs**, thêm:
     - `http://localhost:3000/api/auth/callback` (chạy local)
     - `https://<domain-production>/api/auth/callback` (khi deploy)
4. Bấm Create → copy **Client ID** và **Client secret**.

## Bước 2 — Điền biến môi trường

Mở `.env.local` và điền:

```
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
APP_SESSION_SECRET=<chuỗi ngẫu nhiên 32 byte hex>   # đã tạo sẵn cho máy này
# APP_ADMIN_EMAILS=admin2@dautruonghoctap.io.vn      # tùy chọn
CTV_ACCESS_GROUP_EMAIL=ctv@dautruonghoctap.io.vn
CTV_TRIAL_GROUP_EMAIL=2k9-hoc-thu@dautruonghoctap.io.vn
```

Tạo session secret mới (nếu cần):

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Bước 3 — Cấp quyền cho một CTV

1. Admin (anh) tạo tài khoản `@dautruonghoctap.io.vn` cho CTV trong Google
   Workspace Admin.
2. Thêm email CTV vào Google Group đã khai báo ở `CTV_ACCESS_GROUP_EMAIL`
   (ví dụ `ctv@dautruonghoctap.io.vn`).
3. CTV vào web, bấm **Đăng nhập với Google**, chọn tài khoản nội bộ → thấy trang
   CTV và chỉ thao tác được nhóm học thử `CTV_TRIAL_GROUP_EMAIL`.

## Kiểm thử nhanh

```
npm run dev
```

- Mở `http://localhost:3000` → màn đăng nhập.
- Đăng nhập tài khoản admin → thấy đầy đủ Dashboard/Giao dịch/...
- Đăng nhập tài khoản CTV đã nằm trong `CTV_ACCESS_GROUP_EMAIL` → chỉ thấy quyền
  CTV; thử thêm học viên vào nhóm học thử hoạt động; gọi nhóm khác qua API sẽ bị
  chặn 403.
- Đăng xuất bằng nút ở góc trên (hoặc thẻ user ở sidebar).
```
