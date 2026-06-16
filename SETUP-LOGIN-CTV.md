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
  - **CTV** = mọi tài khoản domain còn lại. Chỉ thấy trang "Nhóm của tôi".
- **Cấp quyền nhóm = thêm CTV vào Google Group.** Khi CTV đăng nhập, app gọi
  Directory API `groups.list({ userKey })` → trả đúng các nhóm họ là thành viên.
  Mọi thao tác (xem/thêm/xóa/đổi role thành viên) đều được kiểm tra lại membership
  ở server (`hasMember`) trước khi cho phép.

> CTV có **full quyền** quản lý thành viên trên nhóm họ thuộc về (theo yêu cầu:
> nhóm học thử tách biệt nên yên tâm). Để rút quyền một CTV với một nhóm, chỉ cần
> xóa họ khỏi nhóm đó.

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
```

Tạo session secret mới (nếu cần):

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Bước 3 — Cấp quyền cho một CTV

1. Admin (anh) tạo tài khoản `@dautruonghoctap.io.vn` cho CTV trong Google
   Workspace Admin.
2. Trong app (đăng nhập bằng tài khoản admin) → trang **Nhóm** → một nhóm →
   **Quản lý thành viên** → thêm email CTV vào nhóm.
   - Hoặc dùng Google Groups trực tiếp / script bulk có sẵn.
3. CTV vào web, bấm **Đăng nhập với Google**, chọn tài khoản nội bộ → chỉ thấy
   đúng các nhóm đã được thêm.

## Kiểm thử nhanh

```
npm run dev
```

- Mở `http://localhost:3000` → màn đăng nhập.
- Đăng nhập tài khoản admin → thấy đầy đủ Dashboard/Giao dịch/...
- Đăng nhập tài khoản CTV (đã thêm vào 1 nhóm) → chỉ thấy "Nhóm của tôi" với
  đúng nhóm đó; thử thêm/xóa thành viên hoạt động; gọi nhóm khác qua API sẽ bị
  chặn 403.
- Đăng xuất bằng nút ở góc trên (hoặc thẻ user ở sidebar).
```
