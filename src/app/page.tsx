import { CourseManagerApp } from "@/components/CourseManagerApp";
import { LoginScreen } from "@/components/LoginScreen";
import { getSession, isOAuthConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ authError?: string }>;
}) {
  const { authError } = await searchParams;
  const configured = isOAuthConfigured();
  const session = configured ? await getSession() : null;
  const domain = process.env.GOOGLE_WORKSPACE_DOMAIN?.trim() || "dautruonghoctap.io.vn";

  if (!session) {
    return <LoginScreen domain={domain} configured={configured} authError={authError} />;
  }

  return <CourseManagerApp session={session} />;
}
