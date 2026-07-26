// Monogram thương hiệu "Đấu Trường Học Tập" — vòng đấu trường ôm chữ Đ (Đấu),
// với chấm vàng vô địch ở đỉnh (12 giờ). Vẽ bằng SVG nội tuyến nên không phụ
// thuộc file ảnh (public/logo.png đã bị gỡ). Là component thuần, dùng được ở cả
// server (LoginScreen) lẫn client (CourseManagerApp).
//
// Muốn quay lại logo ảnh: đặt logo.png vào /public rồi thay <ArenaMark/> bằng
// <Image src="/logo.png" .../> ở LoginScreen và CourseManagerApp.
export function ArenaMark({
  size,
  title = "Đấu Trường Học Tập",
}: {
  size?: number;
  title?: string;
}) {
  return (
    <svg
      className="arena-mark"
      viewBox="0 0 48 48"
      width={size ?? "100%"}
      height={size ?? "100%"}
      role="img"
      aria-label={title}
      style={{ display: "block" }}
    >
      {/* vòng ngoài — thành đấu trường */}
      <circle cx="24" cy="24" r="20.6" fill="none" stroke="#12241f" strokeWidth="2.4" />
      {/* vòng trong mảnh — bậc khán đài */}
      <circle cx="24" cy="24" r="15.4" fill="none" stroke="#c9922e" strokeWidth="1" opacity="0.55" />
      {/* chấm vàng vô địch ở đỉnh, đè lên thành */}
      <circle cx="24" cy="3.4" r="2.9" fill="#c9922e" />
      {/* chữ Đ — chữ đầu của "Đấu" */}
      <text
        x="24"
        y="24.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily='var(--font-be-vietnam), "Segoe UI", system-ui, sans-serif'
        fontWeight={700}
        fontSize="23"
        fill="#12241f"
      >
        Đ
      </text>
    </svg>
  );
}
