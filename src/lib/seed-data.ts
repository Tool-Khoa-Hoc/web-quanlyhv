import type { AppState } from "./types";

// Danh mục nhóm KHÔNG còn hard-code nữa.
// Nhóm được nạp trực tiếp từ Google qua Admin SDK (nút "Đồng bộ từ Google"
// trong trang Nhóm) → bảo đảm danh sách + số thành viên luôn khớp tài khoản thật.
// Vì vậy state khởi tạo để trống groups; người dùng bấm đồng bộ để nạp dữ liệu thật.

export const seedState: AppState = {
  ctvs: [
    {
      id: "ctv-default",
      code: "CTV000",
      name: "CTV mặc định",
      email: "ctv@example.com",
      commissionRate: 0.5,
    },
  ],
  students: [],
  groups: [],
  groupMembers: [],
  enrollments: [],
  jobs: [],
  settings: {
    defaultCommissionRate: 0.5,
    minDelay: 5,
    maxDelay: 15,
    allowlistEmails: ["tamatm6713@gmail.com"],
  },
};
