# Cấu hình Google Admin SDK cho app

App này quản lý nhóm Google bằng **Admin SDK Directory API** cho domain
`dautruonghoctap.io.vn`. Phần gọi API chạy ở **server** (Next.js API routes), Service
Account key **không bao giờ** lộ ra trình duyệt.

App **không cần OAuth Client ID / `NEXT_PUBLIC_GOOGLE_CLIENT_ID`** nữa. Luồng đúng hiện tại là
Service Account + Domain-wide Delegation, rồi impersonate một tài khoản super admin.

> ⚠️ Admin SDK chỉ quản lý được nhóm thuộc **domain Workspace** của anh. Nhóm consumer
> `@googlegroups.com` KHÔNG dùng được Admin SDK — đã bỏ khỏi app.

---

## Bước 1 — Tạo project + bật API (Google Cloud Console)

1. Vào https://console.cloud.google.com → tạo project mới (hoặc chọn project sẵn có).
2. **APIs & Services → Library** → tìm **Admin SDK API** → **Enable**.
3. Nếu dùng script share Drive cho Google Group, tìm thêm **Google Drive API** → **Enable**.

## Bước 2 — Tạo Service Account + key

1. **APIs & Services → Credentials → Create Credentials → Service account**.
2. Đặt tên (vd `group-manager`) → Create → Done (không cần cấp role IAM nào).
3. Mở Service Account vừa tạo → tab **Keys → Add key → Create new key → JSON**.
4. Tải file JSON về. **Lưu file này an toàn, KHÔNG commit lên git.**
5. Mở file, ghi lại:
   - `client_email` (dạng `...@...iam.gserviceaccount.com`)
6. Quay lại trang Service Account → **Show advanced settings** → phần **Domain-wide delegation** →
   copy **Client ID**. Đây là ID sẽ dùng ở Bước 3.

## Bước 3 — Bật Domain-wide Delegation (Google Admin Console)

> Phần này cần tài khoản **super admin** của `dautruonghoctap.io.vn`.

1. Vào https://admin.google.com → **Security → Access and data control → API controls**.
2. Mục **Domain-wide delegation** → **Manage Domain Wide Delegation → Add new**.
3. **Client ID**: dán Client ID của Service Account ở Bước 2.
4. **OAuth scopes** (dán đúng một dòng, phân tách bằng dấu phẩy):
   ```
   https://www.googleapis.com/auth/admin.directory.group,https://www.googleapis.com/auth/admin.directory.group.member,https://www.googleapis.com/auth/drive
   ```
5. **Authorize**.

## Bước 4 — Khai báo biến môi trường

1. Copy file `.env.local.example` thành `.env.local`.
2. Điền:
   - `GOOGLE_WORKSPACE_DOMAIN=dautruonghoctap.io.vn`
   - `GOOGLE_ADMIN_IMPERSONATE_EMAIL=` email **super admin** của domain (vd `admin@dautruonghoctap.io.vn`).
   - `GOOGLE_ADMIN_SA_KEY_FILE=` đường dẫn tuyệt đối tới file JSON đã tải (vd để trong thư mục `secrets/`).
     - Khi deploy lên hosting, khuyên dùng `GOOGLE_ADMIN_SA_KEY_BASE64=` thay cho file path.
     - Hoặc dùng `GOOGLE_ADMIN_SA_KEY=` (dán nguyên JSON 1 dòng).

> File `.env.local` và file JSON key **không được commit**. Nên tạo thư mục `secrets/`
> và thêm `secrets/` + `.env.local` vào `.gitignore`.

## Bước 5 — Cài thư viện & chạy

```powershell
npm install
npm run dev
```

Vào trang **Nhóm** → bấm **"Đồng bộ từ Google"**:
- Danh sách nhóm + **số thành viên thật** sẽ hiện ra.
- Bấm **"Quản lý thành viên"** → thấy member thật, thêm/xóa/đổi vai trò → tác động **trực tiếp** lên Google.

Trong web app, vào **Cài đặt → Kiểm tra Admin SDK**:
- Nếu hiện **Sẵn sàng**, Service Account + Domain-wide Delegation đã chạy được.
- Nếu báo lỗi, xem dòng lỗi ngay dưới panel Admin SDK rồi đối chiếu bảng dưới đây.

## Script tạo group rồi share Drive cho group

Sau khi đã bật thêm Google Drive API và thêm scope `https://www.googleapis.com/auth/drive`
vào Domain-wide Delegation, chạy:

```powershell
npm run create-group-share-drive -- --group-email 2k9-toan@dautruonghoctap.io.vn --group-name "2K9 Toán" --drive-id "DRIVE_FILE_OR_FOLDER_ID" --role reader
```

Role thường dùng:
- `reader`: chỉ xem file/folder.
- `commenter`: xem và comment file.
- `writer`: sửa file/folder trong My Drive.
- `fileOrganizer` / `organizer`: dùng cho Shared Drive khi cần quyền quản lý nội dung/thành viên.

Muốn test trước không ghi dữ liệu:

```powershell
npm run create-group-share-drive -- --group-email 2k9-toan@dautruonghoctap.io.vn --drive-id "DRIVE_FILE_OR_FOLDER_ID" --role reader --dry-run
```

Lưu ý: tài khoản `GOOGLE_ADMIN_IMPERSONATE_EMAIL` phải có quyền share file/folder đó. Với Shared Drive,
script dùng `supportsAllDrives=true` và `useDomainAdminAccess=true`, nhưng domain admin vẫn phải thuộc đúng domain của Shared Drive.

---

## Kiểm tra nhanh khi lỗi

| Thông báo | Nguyên nhân thường gặp |
|---|---|
| `Chưa cấu hình Service Account` | Thiếu `GOOGLE_ADMIN_SA_KEY_BASE64` / `GOOGLE_ADMIN_SA_KEY` / `..._FILE`. |
| `unauthorized_client` / `403` | Chưa bật domain-wide delegation, hoặc dán sai `client_id`/scopes ở Bước 3. |
| `Not Authorized to access this resource` | `GOOGLE_ADMIN_IMPERSONATE_EMAIL` không phải super admin của domain. |
| `Domain not found` / nhóm trống | Sai `GOOGLE_WORKSPACE_DOMAIN`. |

> Sau khi đổi `.env.local` phải **khởi động lại** `npm run dev`.

Tài liệu Google tham chiếu:
- https://developers.google.com/workspace/guides/create-credentials
- https://developers.google.com/workspace/admin/directory/v1/guides/authorizing
- https://developers.google.com/workspace/admin/directory/v1/guides/manage-group-members
