import Image from "next/image";
import { AlertTriangle } from "lucide-react";

function GoogleGLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.346l2.582-2.581C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

export function LoginScreen({
  domain,
  configured,
  authError,
}: {
  domain: string;
  configured: boolean;
  authError?: string;
}) {
  return (
    <div className="login-screen">
      <section className="login-card">
        <div className="login-logo">
          <Image
            src="/logo.png"
            alt="Đấu Trường Học Tập"
            width={200}
            height={200}
            priority
          />
        </div>
        <h1>Quản lý khóa học</h1>
        <p className="login-sub">
          Đăng nhập bằng tài khoản Google nội bộ <strong>@{domain}</strong> do quản trị viên cấp.
        </p>

        {authError ? (
          <div className="login-alert">
            <AlertTriangle size={16} />
            <span>{authError}</span>
          </div>
        ) : null}

        {configured ? (
          <a className="google-btn" href="/api/auth/login">
            <span className="google-btn-icon">
              <GoogleGLogo />
            </span>
            <span className="google-btn-text">Đăng nhập bằng Google</span>
          </a>
        ) : (
          <div className="login-alert">
            <AlertTriangle size={16} />
            <span>
              Chưa cấu hình đăng nhập Google. Cần đặt GOOGLE_OAUTH_CLIENT_ID,
              GOOGLE_OAUTH_CLIENT_SECRET và APP_SESSION_SECRET trong .env.local.
            </span>
          </div>
        )}

        <p className="login-foot">
          Cộng tác viên chỉ thấy và quản lý các nhóm được cấp quyền. Tài khoản ngoài domain sẽ bị từ chối.
        </p>
      </section>
    </div>
  );
}
