import {
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FlaskConical,
  GraduationCap,
  Layers,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import { notFound } from "next/navigation";

import { ArenaMark } from "@/components/ArenaMark";

// TEMP design-preview harness — reproduces the real class contract with mock
// Vietnamese data so the dashboard/login can be screenshotted and critiqued
// without a live Google session. Delete this route before shipping.

const nav = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Giao dịch", icon: ReceiptText },
  { label: "Dòng tiền", icon: TrendingUp },
  { label: "Học thử", icon: FlaskConical },
  { label: "CTV", icon: Users },
  { label: "Học viên", icon: GraduationCap },
  { label: "Nhóm", icon: Layers },
  { label: "Jobs", icon: ListChecks },
  { label: "Cài đặt", icon: Settings },
];

const money = (v: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(v);

const paid = [
  { gmail: "minhthu2007@gmail.com", ctv: "Lê Hoàng · CTV012", course: "Combo Toán–Lý–Hóa", take: 840000, status: "received" },
  { gmail: "quangdai.k57@gmail.com", ctv: "Ngọc Ánh · CTV004", course: "Luyện đề Toán THPT", take: 600000, status: "pending" },
  { gmail: "phuongvy.hs@gmail.com", ctv: "Ngọc Ánh · CTV004", course: " Tiếng Anh nền tảng", take: 450000, status: "received" },
  { gmail: "tuankiet2008@gmail.com", ctv: "Đức Huy · CTV009", course: "Combo KHTN", take: 1020000, status: "pending" },
  { gmail: "hoaian.study@gmail.com", ctv: "Lê Hoàng · CTV012", course: "Vật lý chuyên đề", take: 520000, status: "received" },
];

const ctvDebt = [
  { name: "Đức Huy · CTV009", pending: 3, debt: 1620000 },
  { name: "Ngọc Ánh · CTV004", pending: 2, debt: 980000 },
  { name: "Lê Hoàng · CTV012", pending: 1, debt: 420000 },
];

const trend = [12, 18, 9, 22, 16, 28, 24, 31, 19, 26, 34, 30];

export default function DesignPreview() {
  // Route xem thử thiết kế — chỉ hoạt động ở môi trường dev, không lộ ở production.
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Điều hướng chính">
        <div className="brand">
          <div className="brand-mark">
            <ArenaMark />
          </div>
          <div>
            <strong>Đấu Trường Học Tập</strong>
            <span>Admin console</span>
          </div>
        </div>
        <nav className="nav-list">
          {nav.map((item) => (
            <button key={item.label} className={item.active ? "nav-item active" : "nav-item"} type="button">
              <item.icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-status-card">
          <ShieldCheck size={18} />
          <div>
            <strong>Admin SDK</strong>
            <span>admin@dautruonghoctap.io.vn</span>
          </div>
        </div>
        <div className="admin-status-card user-card">
          <div className="user-avatar">T</div>
          <div>
            <strong>Trần Anh Tú</strong>
            <span>tamatm6713@gmail.com</span>
            <span className="status-badge info">Quản trị viên</span>
          </div>
          <span className="user-logout">
            <LogOut size={16} />
          </span>
        </div>
      </aside>

      <main className="main" id="main-content">
        <header className="topbar">
          <div className="search-box">
            <Search size={18} aria-hidden="true" />
            <input placeholder="Tìm kiếm học viên, CTV, giao dịch, nhóm..." aria-label="Tìm kiếm dữ liệu" />
          </div>
          <div className="topbar-actions">
            <button className="button secondary" type="button">
              <FlaskConical size={17} />
              <span>Thêm học thử</span>
            </button>
            <button className="button primary" type="button">
              <Plus size={17} />
              <span>Thêm giao dịch</span>
            </button>
            <span className="button ghost">
              <LogOut size={17} aria-hidden="true" />
              <span>Đăng xuất</span>
            </span>
          </div>
        </header>

        <section className="content-stack">
          <div className="page-heading">
            <div>
              <h1>Dashboard</h1>
              <p>Công nợ, chuyển đổi học thử và queue Google Group trong một màn hình.</p>
            </div>
            <button className="button secondary" type="button">
              <ArrowUpRight size={17} />
              <span>Xem giao dịch</span>
            </button>
          </div>

          <div className="metric-grid">
            <section className="metric-card blue">
              <div className="metric-icon">
                <CircleDollarSign size={20} />
              </div>
              <span>Anh đáng nhận</span>
              <strong>{money(28450000)}</strong>
            </section>
            <section className="metric-card green">
              <div className="metric-icon">
                <CheckCircle2 size={20} />
              </div>
              <span>Đã thu</span>
              <strong>{money(21400000)}</strong>
            </section>
            <section className="metric-card amber">
              <div className="metric-icon">
                <WalletCards size={20} />
              </div>
              <span>Còn nợ</span>
              <strong>{money(7050000)}</strong>
            </section>
          </div>

          <div className="dashboard-grid">
            <section className="panel span-12">
              <div className="panel-header">
                <h2>Doanh thu theo ngày</h2>
                <span>7 khóa chưa trả</span>
              </div>
              <div className="bars-chart">
                <svg viewBox="0 0 480 180" preserveAspectRatio="none" role="img" aria-label="Biểu đồ doanh thu">
                  {trend.map((v, i) => {
                    const w = 480 / trend.length;
                    const h = (v / 34) * 150;
                    return <rect key={i} className="bar-income" x={i * w + 6} y={170 - h} width={w - 12} height={h} rx={4} />;
                  })}
                </svg>
              </div>
            </section>

            <section className="panel span-8">
              <div className="panel-header">
                <h2>Giao dịch gần đây</h2>
                <span>Bảng giống Excel</span>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Gmail</th>
                      <th>CTV</th>
                      <th>Môn/Combo</th>
                      <th className="numeric">Anh nhận</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paid.map((r) => (
                      <tr key={r.gmail}>
                        <td>
                          <strong>{r.gmail}</strong>
                        </td>
                        <td>{r.ctv}</td>
                        <td>{r.course}</td>
                        <td className="numeric money-cell">{money(r.take)}</td>
                        <td>
                          <span className={r.status === "received" ? "status-badge success" : "status-badge warning"}>
                            {r.status === "received" ? "Đã trả" : "Chưa trả"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="dashboard-side-stack span-4">
              <section className="panel">
                <div className="panel-header">
                  <h2>Công nợ theo CTV</h2>
                  <span>Ưu tiên thu</span>
                </div>
                <div className="stack-list">
                  {ctvDebt.map((row) => (
                    <div className="debt-row" key={row.name}>
                      <div>
                        <strong>{row.name}</strong>
                        <span>{row.pending} giao dịch chờ</span>
                      </div>
                      <div className="money-cell debt">{money(row.debt)}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <h2>Jobs mới nhất</h2>
                  <span>Hôm nay</span>
                </div>
                <div className="stack-list">
                  <div className="task-row">
                    <Clock3 size={17} />
                    <div>
                      <strong>hoaian.study@gmail.com</strong>
                      <span>Hết thử 28/07</span>
                    </div>
                  </div>
                  <div className="task-row">
                    <RefreshCw size={17} />
                    <div>
                      <strong>Thêm minhthu2007 vào Combo Toán–Lý–Hóa</strong>
                      <span>Đang chạy</span>
                    </div>
                  </div>
                  <div className="task-row">
                    <RefreshCw size={17} />
                    <div>
                      <strong>Xóa quangdai.k57 khỏi nhóm học thử</strong>
                      <span>Chờ xử lý</span>
                    </div>
                    <button className="mini-button" type="button">
                      Thử lại
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
