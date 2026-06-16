# PLAN — Tool quản lý khóa học (Excel → Google Group, headless + 2captcha)

## 1. Mục tiêu
- Nhập danh sách khóa học & học viên bằng **file Excel**.
- Tự động **thêm email học viên vào Google Group** tương ứng (qua groups.google.com).
- Chạy **ngầm (headless)**, không hiện cửa sổ trình duyệt.
- Đăng nhập Google bằng **session đã lưu** (cookies/token) để khỏi nhập mật khẩu + né captcha.
- **2captcha** làm dự phòng khi Google vẫn bắt giải captcha/reCAPTCHA.
- Ghi kết quả ngược lại Excel (thành công / lỗi / thời gian).

## 2. Tech stack
| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| Ngôn ngữ | Python 3.11+ | Hệ sinh thái automation tốt |
| Trình duyệt tự động | **Playwright** (Chromium) | Hỗ trợ headless + `storage_state` lưu session chuẩn |
| Đọc/ghi Excel | **openpyxl** (hoặc pandas) | Đọc/ghi `.xlsx`, ghi status ngược lại |
| Giải captcha | **2captcha-python** (`twocaptcha`) | Giải reCAPTCHA v2/v3 |
| Cấu hình | `.env` + `config.py` | Lưu API key, đường dẫn, tốc độ |
| Log | `logging` + file log | Theo dõi & debug |

## 3. Chiến lược đăng nhập Google (quan trọng nhất)
> Google chặn bot rất mạnh. Tự động gõ user/pass mỗi lần **không** đáng tin (hay bị bắt verify SĐT, dù có 2captcha). Cách ổn định nhất: **đăng nhập 1 lần bằng tay → lưu session → tái sử dụng**.

**Luồng:**
1. **Lần đầu (setup):** chạy script `login_setup.py` ở chế độ **hiện trình duyệt** → anh tự đăng nhập Google 1 lần (kể cả 2FA) → script lưu lại `google_session.json` (cookies + localStorage, đây chính là "token" anh nói).
2. **Các lần sau:** tool nạp `google_session.json` → vào thẳng groups.google.com ở trạng thái đã login → chạy **headless**, không cần mật khẩu, hầu như không gặp captcha.
3. **Dự phòng 2captcha:** trong phiên nếu Google bất ngờ hiện reCAPTCHA → module `captcha_solver` gọi 2captcha lấy token → bơm vào trang → tiếp tục.
4. Session hết hạn (sau vài tuần) → chạy lại bước 1 để làm mới.

## 4. Cấu trúc file Excel (input)
**Sheet `KhoaHoc`:**
| course_id | ten_khoa_hoc | group_email |
|---|---|---|
| KH01 | Luyện thi A | lop-a@googlegroups.com |

**Sheet `HocVien`:**
| email | course_id | status | thoi_gian | ghi_chu |
|---|---|---|---|---|
| hocvien1@gmail.com | KH01 | (để trống) | | |

- `status`: tool tự điền `DONE` / `ERROR` / `SKIP`. Chỉ xử lý dòng chưa `DONE`.
- `thoi_gian`, `ghi_chu`: tool tự ghi (thời điểm thêm, hoặc lý do lỗi).

## 5. Kiến trúc code
```
course-tool/
├── .env                  # 2CAPTCHA_KEY, đường dẫn file
├── config.py             # đọc cấu hình, hằng số tốc độ/delay
├── excel_io.py           # đọc khóa học/học viên, ghi status ngược lại
├── google_session.py     # login_setup (1 lần) + load session
├── captcha_solver.py     # tích hợp 2captcha (dự phòng)
├── group_manager.py      # Playwright: mở group, add member, submit
├── login_setup.py        # script chạy 1 lần để lưu session
├── main.py               # orchestrator: đọc Excel → loop → ghi kết quả
├── data/
│   ├── danh_sach.xlsx
│   └── google_session.json
└── logs/run.log
```

## 6. Luồng xử lý chính (main.py)
1. Đọc `KhoaHoc` + `HocVien` từ Excel.
2. Lọc học viên có `status` rỗng/khác `DONE`.
3. Nạp `google_session.json` → mở Playwright headless.
4. Với mỗi học viên:
   - Map `course_id` → `group_email`.
   - Vào `groups.google.com/.../members` của group đó.
   - Bấm **Add members** → nhập email → (chọn quyền) → **Submit**.
   - Nếu gặp captcha → gọi `captcha_solver` (2captcha) → tiếp tục.
   - Chờ xác nhận thành công → ghi `DONE` + thời gian; lỗi → ghi `ERROR` + lý do.
   - **Delay ngẫu nhiên 5–15s** giữa các thao tác (giả người thật, tránh bị chặn).
5. Lưu Excel sau mỗi N học viên (tránh mất tiến độ nếu crash).
6. Tổng kết: in số thành công / lỗi.

## 7. Các giai đoạn triển khai
- **Phase 0 — Khung dự án:** tạo cấu trúc, `.env`, cài Playwright + lib. (0.5 ngày)
- **Phase 1 — Excel I/O:** đọc/ghi đúng định dạng, test với file mẫu. (0.5 ngày)
- **Phase 2 — Session login:** `login_setup.py` lưu session, verify vào được groups.google.com headless. (1 ngày)
- **Phase 3 — Add member:** tự động thêm 1 học viên vào 1 group thành công. (1–1.5 ngày)
- **Phase 4 — 2captcha:** tích hợp giải captcha dự phòng, test ép captcha. (0.5–1 ngày)
- **Phase 5 — Orchestrator + log + delay:** chạy full danh sách, ghi kết quả, retry lỗi. (1 ngày)
- **Phase 6 — Hoàn thiện:** xử lý lỗi (email trùng, group sai, session hết hạn), tài liệu chạy. (0.5 ngày)

## 8. Rủi ro & lưu ý
- **ToS Google:** tự động hóa thao tác trên tài khoản có thể vi phạm điều khoản và có rủi ro bị khóa tài khoản. Giảm thiểu bằng: tái dùng session (không brute login), giới hạn tốc độ, delay như người thật, volume thấp. Dùng cho chính học viên/khóa học của anh.
- **Session hết hạn:** cần chạy lại setup định kỳ → tool nên báo rõ khi session chết.
- **UI Google thay đổi:** selector có thể đổi → tách selector ra config để dễ sửa.
- **2captcha tốn phí & có độ trễ:** chỉ là dự phòng; chiến lược chính vẫn là session reuse.
- **Email không hợp lệ / đã trong group:** xử lý như SKIP, không tính lỗi.

## 9. Cần anh chuẩn bị
- API key 2captcha (nạp sẵn tiền).
- 1 tài khoản Gmail có quyền quản lý các Google Group (owner/manager).
- Danh sách group email + file Excel học viên mẫu.
