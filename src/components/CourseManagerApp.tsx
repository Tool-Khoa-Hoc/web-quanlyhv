"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Filter,
  FlaskConical,
  GraduationCap,
  Link2,
  LockKeyhole,
  LogOut,
  LucideIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Trophy,
  TrendingUp,
  UserPlus,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { FormEvent, MouseEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { ArenaMark } from "./ArenaMark";

import {
  byId,
  cashflowSeries,
  type CashflowGranularity,
  currency,
  ctvDisplay,
  expenseCategoryLabel,
  financeSummary,
  findOrCreateStudent,
  jobLabel,
  makeId,
  memberCount,
  membersByGroup,
  ownerShare,
  paidEnrollments,
  shortDate,
  statusLabel,
  todayISO,
  trialLabel,
} from "@/lib/calculations";
import { seedState } from "@/lib/seed-data";
import {
  addDaysISO,
  buildModelShape,
  createJob,
  jobGroupLabel,
  LEGACY_STORAGE_KEYS,
  matchesQuery,
  normalizePersistedState,
  resolveEnrollmentGroup,
  STORAGE_KEY,
} from "@/lib/app-model";
import {
  apiAddMember,
  apiAddTrial,
  apiCreateGroup,
  apiGroupToCourseGroup,
  apiLockStudentAccess,
  apiRemoveMember,
  apiUpdateRole,
  apiUpdateTrialStatus,
  fetchAdminStatus,
  fetchDomainMembers,
  fetchCtvActivityJobs,
  fetchGroups,
  fetchLedger,
  fetchMembers,
  fetchTrialRecords,
  roleFromApi,
  saveLedger,
  type LedgerData,
} from "@/lib/admin-api";
import { getErrorMessage } from "@/lib/error-message";
import { trimJobHistory } from "@/lib/job-history";
import type {
  ApiAdminStatus,
  ClientSession,
  DomainMember,
  TrialRecord,
  TrialStatus,
  ApiLockStudentResult,
} from "@/lib/admin-types";
import type {
  AppState,
  CourseGroup,
  Ctv,
  Enrollment,
  Expense,
  ExpenseCategory,
  GroupJob,
  GroupRole,
  JobStatus,
  PaymentStatus,
  TrialResult,
  ViewKey,
} from "@/lib/types";


type AdminSdkState =
  | { state: "checking" }
  | { state: "ready"; details: ApiAdminStatus }
  | { state: "error"; message: string; checkedAt: string };

interface NavItem {
  key: ViewKey;
  label: string;
  /** Nhãn ngắn cho thanh điều hướng dưới ở mobile (chỗ hẹp, không được xuống dòng). */
  shortLabel?: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { key: "students", label: "Học viên", icon: GraduationCap },
  { key: "cashflow", label: "Dòng tiền", icon: TrendingUp },
  { key: "ctv", label: "CTV", icon: Users },
  { key: "settings", label: "Cài đặt", icon: Settings },
];

// Thanh dưới ở mobile: 3 mục dùng nhiều nhất + nút "Thêm" (mở sheet chứa Cài đặt
// và nút Đăng xuất). Không màn nào bị mất trên điện thoại.
const mobileNavKeys: ViewKey[] = ["students", "cashflow", "ctv"];
const mobileNavItems = mobileNavKeys
  .map((key) => navItems.find((item) => item.key === key))
  .filter((item): item is NavItem => Boolean(item));

type ModalMode = "transaction" | "trial" | null;

interface PaidFormState {
  gmail: string;
  studentName: string;
  ctvEmail: string;
  ctvName: string;
  groupId: string;
  courseType: string;
  tuition: string;
  date: string;
  note: string;
}

interface EditPaidFormState extends PaidFormState {
  id: string;
  commissionRate: string;
  paymentStatus: PaymentStatus;
  paymentReceivedDate: string;
}

interface TrialFormState {
  gmail: string;
  studentName: string;
  ctvEmail: string;
  ctvName: string;
  groupId: string;
  courseType: string;
  date: string;
  trialEndDate: string;
  note: string;
}

interface GroupFormState {
  name: string;
  groupEmail: string;
  subject: string;
  teacher: string;
  kind: CourseGroup["kind"];
  priceHint: string;
}

function isStudentGroup(group: Pick<CourseGroup, "groupEmail">) {
  const localPart = group.groupEmail.trim().toLowerCase().split("@", 1)[0] ?? "";
  return localPart.startsWith("sv-");
}

function groupKindLabel(kind: CourseGroup["kind"]) {
  if (kind === "trial") return "Học thử";
  if (kind === "combo") return "Combo";
  return "Trả phí";
}

type CourseTrack = "thpt" | "student";

interface CtvFormState {
  code: string;
  name: string;
  email: string;
  commissionRate: string;
}

interface ExpenseInput {
  date: string;
  category: ExpenseCategory;
  amount: number;
  note?: string;
}

const expenseCategories: ExpenseCategory[] = [
  "material",
  "system",
  "marketing",
  "salary",
  "office",
  "other",
];

/**
 * Tìm CTV theo email (tài khoản domain). Chưa có thì tạo mới với hoa hồng mặc định 50%.
 * Trả về state (có thể đã thêm CTV mới) + bản ghi CTV để gắn cho enrollment.
 */
function ctvCodeFromIdentity(name: string, email: string) {
  const source = name.trim() || email.split("@")[0] || "CTV";
  const ascii = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return ascii.slice(0, 8) || "CTV";
}

function resolveCtv(current: AppState, input: { email?: string; name?: string }): { state: AppState; ctv: Ctv } {
  const normalized = input.email?.trim().toLowerCase() ?? "";
  const name = input.name?.trim() ?? "";
  const nameKey = name.toLowerCase();
  const existing = normalized
    ? current.ctvs.find((item) => item.email.trim().toLowerCase() === normalized)
    : current.ctvs.find(
        (item) => item.name.trim().toLowerCase() === nameKey && !item.email.trim(),
      ) ?? current.ctvs.find((item) => item.name.trim().toLowerCase() === nameKey);
  if (existing) return { state: current, ctv: existing };
  if (!normalized && !name) {
    const fallback = current.ctvs[0];
    if (fallback) return { state: current, ctv: fallback };
  }
  const local = (normalized.split("@")[0] || normalized || "ctv").trim();
  const ctv: Ctv = {
    id: makeId("ctv"),
    code: ctvCodeFromIdentity(name, normalized),
    name: name || local,
    email: normalized,
    commissionRate: current.settings.defaultCommissionRate,
  };
  return { state: { ...current, ctvs: [ctv, ...current.ctvs] }, ctv };
}

function resolveCtvByEmail(current: AppState, email: string): { state: AppState; ctv: Ctv } {
  return resolveCtv(current, { email });
}

export function CourseManagerApp({ session }: { session: ClientSession }) {
  const isAdmin = session.role === "admin";
  const visibleNavItems = isAdmin ? navItems : navItems.filter((item) => item.key === "students");
  // 4 mục ghim ở thanh dưới; phần còn lại đưa vào sheet "Thêm".
  const mobileBarItems = isAdmin ? mobileNavItems : visibleNavItems;
  const mobileSheetItems = visibleNavItems.filter(
    (item) => !mobileBarItems.some((barItem) => barItem.key === item.key),
  );

  const [state, setState] = useState<AppState>(seedState);
  const [hydrated, setHydrated] = useState(false);
  const [activeView, setActiveView] = useState<ViewKey>("students");
  // Tab con của workspace "Học viên" + nhóm cần mở sẵn khi bấm từ sidebar.
  const [studentTab, setStudentTab] = useState<StudentTab>(isAdmin ? "paid" : "groups");
  const [focusGroupId, setFocusGroupId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalMode>(null);
  const [ctvFilter, setCtvFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | PaymentStatus>("all");
  const [trialFilter, setTrialFilter] = useState<"all" | TrialResult>("all");
  const [editingPaidId, setEditingPaidId] = useState<string | null>(null);
  const [adminNotice, setAdminNotice] = useState("");
  const [adminStatus, setAdminStatus] = useState<AdminSdkState>({ state: "checking" });
  // Kho học thử dùng chung (Google Sheet) — đồng bộ giữa CTV và admin.
  const [trialRecords, setTrialRecords] = useState<TrialRecord[]>([]);
  // Thành viên nội bộ (domain) trong nhóm học thử — dùng cho dropdown chọn CTV.
  const [domainMembers, setDomainMembers] = useState<DomainMember[]>([]);
  // Nhật ký thao tác CTV được ghi ở server, tách khỏi queue cục bộ của admin.
  const [ctvActivityJobs, setCtvActivityJobs] = useState<GroupJob[]>([]);

  // ===== Đồng bộ sổ cái nghiệp vụ (CTV/học viên/giao dịch) qua /api/ledger =====
  // stateRef: đọc state mới nhất trong callback debounce mà không bị stale closure.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // rev server đang biết (kiểm tra đụng độ lạc quan).
  const ledgerRevRef = useRef(0);
  // Đã nạp xong sổ cái lần đầu chưa (trước đó không được phép ghi đè/đẩy lên).
  const ledgerReadyRef = useRef(false);
  // true khi state đổi do áp dữ liệu từ server → bỏ qua 1 lần ghi để tránh vòng lặp.
  const ledgerSyncingRef = useRef(false);
  // Khóa tuần tự + cờ "còn thay đổi" để gộp nhiều lần ghi liên tiếp.
  const ledgerSavingRef = useRef(false);
  const ledgerDirtyRef = useRef(false);
  const ledgerSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Áp sổ cái từ server vào state (giữ nguyên groups/groupMembers cục bộ).
  const applyLedger = useCallback((ledger: LedgerData) => {
    ledgerRevRef.current = ledger.rev;
    ledgerSyncingRef.current = true;
    setState((current) => ({
      ...current,
      ctvs: ledger.ctvs,
      students: ledger.students,
      enrollments: ledger.enrollments,
      expenses: ledger.expenses ?? current.expenses,
      jobs: ledger.jobs ?? current.jobs,
      settings: { ...current.settings, ...ledger.settings },
    }));
  }, []);

  // Ghi sổ cái lên server (tuần tự, gộp thay đổi). Đụng độ → nhận bản server.
  const flushLedger = useCallback(async () => {
    if (!isAdmin || !ledgerReadyRef.current) return;
    if (ledgerSavingRef.current) {
      ledgerDirtyRef.current = true;
      return;
    }
    ledgerSavingRef.current = true;
    try {
      do {
        ledgerDirtyRef.current = false;
        const current = stateRef.current;
        const result = await saveLedger(
          {
            ctvs: current.ctvs,
            students: current.students,
            enrollments: current.enrollments,
            expenses: current.expenses,
            jobs: trimJobHistory(current.jobs),
            settings: current.settings,
          },
          ledgerRevRef.current,
        );
        if (result.ok) {
          ledgerRevRef.current = result.ledger.rev;
        } else {
          // Server mới hơn (thiết bị khác vừa ghi) → nhận bản server, dừng.
          applyLedger(result.ledger);
          setAdminNotice("Đã cập nhật dữ liệu mới nhất từ thiết bị khác.");
          break;
        }
      } while (ledgerDirtyRef.current);
    } catch (error) {
      const message = getErrorMessage(error);
      setAdminNotice(`Không lưu được sổ cái dùng chung. Dữ liệu hiện chỉ lưu trên máy này. ${message}`);
    } finally {
      ledgerSavingRef.current = false;
    }
  }, [isAdmin, applyLedger]);

  // Nạp sổ cái lần đầu. Server trống → đẩy dữ liệu cục bộ lên làm bản gốc.
  const loadLedger = useCallback(async () => {
    try {
      const ledger = await fetchLedger();
      if (ledger) {
        applyLedger(ledger);
        ledgerReadyRef.current = true;
        return;
      }
      ledgerReadyRef.current = true;
      await flushLedger();
    } catch {
      ledgerReadyRef.current = true;
    }
  }, [applyLedger, flushLedger]);

  // Làm tươi sổ cái: chỉ áp khi server có rev mới hơn (tránh đè edit cục bộ).
  const refreshLedger = useCallback(async () => {
    if (!isAdmin || !ledgerReadyRef.current) return;
    try {
      const ledger = await fetchLedger();
      if (ledger && ledger.rev > ledgerRevRef.current) applyLedger(ledger);
    } catch {
      // bỏ qua
    }
  }, [isAdmin, applyLedger]);

  const loadTrialRecords = useCallback(async () => {
    try {
      setTrialRecords(await fetchTrialRecords());
    } catch {
      // Sheet chưa cấu hình hoặc lỗi mạng: bỏ qua, danh sách rỗng vẫn dùng được.
    }
  }, []);

  const loadDomainMembers = useCallback(async () => {
    try {
      setDomainMembers(await fetchDomainMembers());
    } catch {
      // Chưa cấu hình Admin SDK / nhóm học thử: bỏ qua, fallback về CTV cục bộ.
    }
  }, []);

  const loadCtvActivityJobs = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setCtvActivityJobs(await fetchCtvActivityJobs());
    } catch {
      // Kho nhật ký chưa cấu hình hoặc tạm lỗi: giữ bản gần nhất đang hiển thị.
    }
  }, [isAdmin]);

  const refreshAdminStatus = useCallback(async () => {
    setAdminStatus({ state: "checking" });
    try {
      const details = await fetchAdminStatus();
      setAdminStatus({ state: "ready", details });
      setAdminNotice("Admin SDK đã sẵn sàng.");
    } catch (error) {
      const message = getErrorMessage(error);
      setAdminStatus({ state: "error", message, checkedAt: new Date().toISOString() });
      setAdminNotice(`Admin SDK chưa sẵn sàng: ${message}`);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void refreshAdminStatus();
  }, [isAdmin, refreshAdminStatus]);

  // Nạp kho học thử chung cho cả admin lẫn CTV (sau khi hydrate).
  useEffect(() => {
    if (!hydrated) return;
    void loadTrialRecords();
  }, [hydrated, loadTrialRecords]);

  // Admin: nạp danh sách thành viên nội bộ trong domain để chọn CTV khi thêm đăng ký.
  useEffect(() => {
    if (!hydrated || !isAdmin) return;
    void loadDomainMembers();
  }, [hydrated, isAdmin, loadDomainMembers]);

  useEffect(() => {
    if (!hydrated || !isAdmin) return;
    void loadCtvActivityJobs();
  }, [hydrated, isAdmin, loadCtvActivityJobs]);

  useEffect(() => {
    try {
      LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AppState;
        setState(normalizePersistedState(parsed));
      }
    } catch {
      setState(seedState);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Local storage can be blocked in private browsing; the in-memory state still works.
    }
  }, [hydrated, state]);

  // Admin: nạp sổ cái dùng chung sau hydrate (đồng bộ giữa các thiết bị).
  useEffect(() => {
    if (!hydrated || !isAdmin) return;
    void loadLedger();
  }, [hydrated, isAdmin, loadLedger]);

  // Admin: state đổi → đẩy lên server (debounce). Bỏ qua lần áp dữ liệu từ server.
  useEffect(() => {
    if (!hydrated || !isAdmin || !ledgerReadyRef.current) return;
    if (ledgerSyncingRef.current) {
      ledgerSyncingRef.current = false;
      return;
    }
    if (ledgerSaveTimer.current) clearTimeout(ledgerSaveTimer.current);
    ledgerSaveTimer.current = setTimeout(() => void flushLedger(), 600);
    return () => {
      if (ledgerSaveTimer.current) clearTimeout(ledgerSaveTimer.current);
    };
  }, [
    hydrated,
    isAdmin,
    flushLedger,
    state.ctvs,
    state.students,
    state.enrollments,
    state.expenses,
    state.jobs,
    state.settings,
  ]);

  // Admin: làm tươi sổ cái khi quay lại tab + poll định kỳ (bắt thay đổi từ máy khác).
  useEffect(() => {
    if (!hydrated || !isAdmin) return;
    const onFocus = () => {
      void refreshLedger();
      void loadTrialRecords();
      void loadCtvActivityJobs();
    };
    window.addEventListener("focus", onFocus);
    const timer = setInterval(onFocus, 20000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [hydrated, isAdmin, refreshLedger, loadTrialRecords, loadCtvActivityJobs]);

  // CTV: tự nạp đúng các nhóm được cấp quyền (server đã lọc theo membership).
  useEffect(() => {
    if (!hydrated || isAdmin) return;
    void syncFromGoogle();
    // syncFromGoogle là function declaration ổn định trong component; chỉ chạy 1 lần sau hydrate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, isAdmin]);

  // Sheet "Thêm" ở mobile: Esc để đóng, và chặn scroll nền khi sheet đang mở.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

  const model = useMemo(() => buildModelShape(state), [state]);

  const filteredPaid = useMemo(() => {
    return model.paid
      .filter((item) => ctvFilter === "all" || item.ctvId === ctvFilter)
      .filter((item) => paymentFilter === "all" || item.paymentStatus === paymentFilter)
      .filter((item) => matchesQuery(item, query, state))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [ctvFilter, model.paid, paymentFilter, query, state]);

  const filteredTrials = useMemo(() => {
    return model.trials
      .filter((item) => ctvFilter === "all" || item.ctvId === ctvFilter)
      .filter((item) => trialFilter === "all" || item.trialResult === trialFilter)
      .filter((item) => matchesQuery(item, query, state))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [ctvFilter, model.trials, query, state, trialFilter]);

  // Cập nhật trạng thái một job theo kết quả gọi Admin SDK (chạy nền, không chặn UI).
  function settleMemberJob(jobId: string, promise: Promise<unknown>) {
    setState((current) => ({
      ...current,
      jobs: current.jobs.map((j) => (j.id === jobId ? { ...j, status: "running" } : j)),
    }));
    promise
      .then(() =>
        setState((current) => ({
          ...current,
          jobs: current.jobs.map((j) =>
            j.id === jobId ? { ...j, status: "done", finishedAt: new Date().toISOString() } : j,
          ),
        })),
      )
      .catch((error: unknown) => {
        const message = getErrorMessage(error);
        setState((current) => ({
          ...current,
          jobs: current.jobs.map((j) =>
            j.id === jobId
              ? { ...j, status: "failed", error: message, finishedAt: new Date().toISOString() }
              : j,
          ),
        }));
        setAdminNotice(`Lỗi đồng bộ Google Group: ${message}`);
      });
  }

  function runGroupJob(job: GroupJob) {
    const group = job.groupId ? state.groups.find((item) => item.id === job.groupId) : undefined;
    const email = job.studentGmail?.trim().toLowerCase();
    if (!group?.groupEmail || !email) {
      const message = "Job thiếu Google Group hoặc Gmail học viên.";
      setState((current) => ({
        ...current,
        jobs: current.jobs.map((item) =>
          item.id === job.id
            ? { ...item, status: "failed", error: message, finishedAt: new Date().toISOString() }
            : item,
        ),
      }));
      setAdminNotice(message);
      return;
    }

    if (job.type === "add_member") {
      settleMemberJob(job.id, apiAddMember(group.groupEmail, email, "member"));
      return;
    }

    if (job.type === "remove_member") {
      settleMemberJob(job.id, apiRemoveMember(group.groupEmail, email));
      return;
    }

    setAdminNotice("Job đổi role cần xử lý trực tiếp trong màn Quản lý thành viên.");
  }

  function addPaidEnrollment(form: PaidFormState) {
    const group = state.groups.find((item) => item.id === form.groupId) ?? state.groups[0];
    if (!group) {
      setAdminNotice("Chưa có Google Group. Bấm 'Đồng bộ từ Google' trong trang Nhóm trước khi thêm giao dịch.");
      setActiveView("students");
      return;
    }
    const resolved = resolveCtv(state, { email: form.ctvEmail, name: form.ctvName });
    const ctv = resolved.ctv;
    const tuition = Number(form.tuition) || group.priceHint || 0;
    const withStudent = findOrCreateStudent(resolved.state, form.gmail, form.studentName);
    const share = ownerShare(tuition, ctv.commissionRate);
    const enrollment: Enrollment = {
      id: makeId("enr"),
      type: "paid",
      date: form.date || todayISO(),
      ctvId: ctv.id,
      studentId: withStudent.studentId,
      groupId: group.id,
      courseType: form.courseType || group.name,
      tuition,
      commissionRateSnapshot: ctv.commissionRate,
      ownerShare: share,
      paymentStatus: "pending",
      note: form.note,
    };

    const job = createJob("add_member", group.id, form.gmail);
    setState({
      ...withStudent.state,
      enrollments: [enrollment, ...withStudent.state.enrollments],
      jobs: [job, ...withStudent.state.jobs],
    });
    if (group?.groupEmail) {
      settleMemberJob(job.id, apiAddMember(group.groupEmail, form.gmail, "member"));
    }
    setModal(null);
    setActiveView("students");
  }

  function addTrialEnrollment(form: TrialFormState) {
    const trialGroup =
      state.groups.find((item) => item.id === form.groupId) ??
      state.groups.find((item) => item.kind === "trial") ??
      state.groups[0];
    if (!trialGroup) {
      setAdminNotice("Chưa có Google Group. Bấm 'Đồng bộ từ Google' trong trang Nhóm trước khi thêm học thử.");
      setActiveView("students");
      return;
    }
    const resolved = resolveCtv(state, { email: form.ctvEmail, name: form.ctvName });
    const ctv = resolved.ctv;
    const withStudent = findOrCreateStudent(resolved.state, form.gmail, form.studentName);
    const enrollment: Enrollment = {
      id: makeId("trial"),
      type: "trial",
      date: form.date || todayISO(),
      ctvId: ctv.id,
      studentId: withStudent.studentId,
      groupId: trialGroup.id,
      courseType: form.courseType || "Học thử",
      tuition: 0,
      commissionRateSnapshot: ctv.commissionRate,
      ownerShare: 0,
      paymentStatus: "pending",
      trialResult: "dang_thu",
      trialEndDate: form.trialEndDate,
      note: form.note,
    };

    const job = createJob("add_member", trialGroup.id, form.gmail);
    setState({
      ...withStudent.state,
      enrollments: [enrollment, ...withStudent.state.enrollments],
      jobs: [job, ...withStudent.state.jobs],
    });
    if (trialGroup?.groupEmail) {
      // Ghi lên Sheet (kho chung) để CTV cũng thấy + gắn người thêm.
      settleMemberJob(
        job.id,
        apiAddTrial(
          trialGroup.groupEmail,
          form.gmail,
          form.studentName,
          form.courseType,
          ctv.email,
          ctv.name,
        ).then(loadTrialRecords),
      );
    }
    setModal(null);
    setActiveView("students");
  }

  function togglePayment(enrollmentId: string) {
    setState((current) => ({
      ...current,
      enrollments: current.enrollments.map((item) => {
        if (item.id !== enrollmentId) return item;
        const nextStatus = item.paymentStatus === "received" ? "pending" : "received";
        return {
          ...item,
          paymentStatus: nextStatus,
          paymentReceivedDate: nextStatus === "received" ? todayISO() : undefined,
        };
      }),
    }));
  }

  function updatePaidEnrollment(form: EditPaidFormState) {
    const target = state.enrollments.find((item) => item.id === form.id && item.type === "paid");
    if (!target) return;

    const previousStudent = state.students.find((item) => item.id === target.studentId);
    const previousEmail = previousStudent?.gmail.trim().toLowerCase() ?? "";
    const nextEmail = form.gmail.trim().toLowerCase();
    if (!nextEmail) {
      setAdminNotice("Gmail học viên không được để trống.");
      return;
    }

    const previousGroupId = target.groupId;
    const nextGroupId = form.groupId || target.groupId;
    const previousGroup = state.groups.find((item) => item.id === previousGroupId);
    const nextGroup = state.groups.find((item) => item.id === nextGroupId);
    const shouldSyncMember =
      Boolean(nextGroupId) && (previousEmail !== nextEmail || previousGroupId !== nextGroupId);
    const removeMemberJob =
      shouldSyncMember && previousEmail ? createJob("remove_member", previousGroupId, previousEmail) : null;
    const addMemberJob = shouldSyncMember ? createJob("add_member", nextGroupId, nextEmail) : null;
    const newJobs = [addMemberJob, removeMemberJob].filter((job): job is GroupJob => Boolean(job));

    setState((current) => {
      const currentTarget = current.enrollments.find((item) => item.id === form.id && item.type === "paid");
      if (!currentTarget) return current;

      const resolved = resolveCtv(current, { email: form.ctvEmail, name: form.ctvName });
      const ctv = resolved.ctv;
      const withStudent = findOrCreateStudent(resolved.state, form.gmail, form.studentName);
      const tuition = Math.max(0, Number(form.tuition) || 0);
      const rateNumber = Number(form.commissionRate);
      const commissionRate = Number.isFinite(rateNumber)
        ? Math.min(1, Math.max(0, rateNumber / 100))
        : currentTarget.commissionRateSnapshot;
      const paymentReceivedDate =
        form.paymentStatus === "received"
          ? form.paymentReceivedDate || currentTarget.paymentReceivedDate || todayISO()
          : undefined;
      const previousStudentId = currentTarget.studentId;
      const nextGroupId = form.groupId || currentTarget.groupId;
      const nextEnrollments = withStudent.state.enrollments.map((item) =>
        item.id === form.id
          ? {
              ...item,
              date: form.date || item.date,
              ctvId: ctv.id,
              studentId: withStudent.studentId,
              groupId: nextGroupId,
              courseType: form.courseType.trim() || item.courseType,
              tuition,
              commissionRateSnapshot: commissionRate,
              ownerShare: ownerShare(tuition, commissionRate),
              paymentStatus: form.paymentStatus,
              paymentReceivedDate,
              note: form.note,
            }
          : item,
      );
      const hasOtherEnrollmentsForPreviousStudent = nextEnrollments.some(
        (item) => item.studentId === previousStudentId,
      );
      let nextStudents = withStudent.state.students.map((student) =>
        student.id === withStudent.studentId
          ? { ...student, name: form.studentName.trim() || student.name }
          : student,
      );
      if (previousStudentId !== withStudent.studentId && !hasOtherEnrollmentsForPreviousStudent) {
        nextStudents = nextStudents.filter((student) => student.id !== previousStudentId);
      }

      let nextGroupMembers = withStudent.state.groupMembers;
      if (removeMemberJob) {
        nextGroupMembers = nextGroupMembers.filter(
          (member) =>
            !(member.groupId === removeMemberJob.groupId && member.email === removeMemberJob.studentGmail),
        );
      }
      if (
        addMemberJob &&
        !nextGroupMembers.some(
          (member) => member.groupId === addMemberJob.groupId && member.email === addMemberJob.studentGmail,
        )
      ) {
        nextGroupMembers = [
          ...nextGroupMembers,
          {
            id: `mem-${addMemberJob.groupId}-${nextEmail}`,
            groupId: nextGroupId,
            email: nextEmail,
            name: form.studentName.trim() || undefined,
            role: "member",
            joinDate: todayISO(),
          },
        ];
      }

      return {
        ...withStudent.state,
        students: nextStudents,
        groupMembers: nextGroupMembers,
        enrollments: nextEnrollments,
        jobs: [...newJobs, ...withStudent.state.jobs],
      };
    });
    if (removeMemberJob && previousGroup?.groupEmail && previousEmail) {
      settleMemberJob(removeMemberJob.id, apiRemoveMember(previousGroup.groupEmail, previousEmail));
    }
    if (addMemberJob && nextGroup?.groupEmail) {
      settleMemberJob(addMemberJob.id, apiAddMember(nextGroup.groupEmail, nextEmail, "member"));
    }
    if (shouldSyncMember) {
      setAdminNotice(`Đã cập nhật khóa: xóa ${previousEmail || "Gmail cũ"} và thêm ${nextEmail}.`);
    }
    setEditingPaidId(null);
    setActiveView("students");
  }

  // Đổi CTV cho 1 giao dịch đã ghi (sửa khi gán nhầm). Tính lại hoa hồng + tiền anh nhận.
  function changeEnrollmentCtv(enrollmentId: string, ctvEmail: string) {
    setState((current) => {
      const target = current.enrollments.find((item) => item.id === enrollmentId);
      if (!target) return current;
      const resolved = resolveCtvByEmail(current, ctvEmail);
      const ctv = resolved.ctv;
      return {
        ...resolved.state,
        enrollments: resolved.state.enrollments.map((item) =>
          item.id === enrollmentId
            ? {
                ...item,
                ctvId: ctv.id,
                commissionRateSnapshot: ctv.commissionRate,
                ownerShare:
                  item.type === "paid"
                    ? ownerShare(item.tuition, ctv.commissionRate)
                    : item.ownerShare,
              }
            : item,
        ),
      };
    });
  }

  function updateTrialResult(enrollmentId: string, result: TrialResult) {
    setState((current) => ({
      ...current,
      enrollments: current.enrollments.map((item) =>
        item.id === enrollmentId ? { ...item, trialResult: result } : item,
      ),
    }));
  }

  // Đổi trạng thái học thử trên kho chung (Sheet) — dùng cho bảng đồng bộ ở admin.
  async function updateServerTrialStatus(groupEmail: string, email: string, status: TrialStatus) {
    try {
      await apiUpdateTrialStatus(groupEmail, email, status);
      await loadTrialRecords();
    } catch (error) {
      const message = getErrorMessage(error);
      setAdminNotice(`Không đổi được trạng thái học thử: ${message}`);
    }
  }

  function convertTrial(enrollmentId: string) {
    const trial = state.enrollments.find((item) => item.id === enrollmentId);
    if (!trial) return;

    const ctv = model.ctvMap.get(trial.ctvId) ?? state.ctvs[0];
    const paidGroup = state.groups.find((item) => item.kind !== "trial") ?? state.groups[0];
    if (!paidGroup) {
      setAdminNotice("Chưa có nhóm trả phí để chuyển học thử.");
      setActiveView("students");
      return;
    }
    const tuition = paidGroup.priceHint || 1200000;
    const share = ownerShare(tuition, ctv.commissionRate);
    const student = model.studentMap.get(trial.studentId);
    const paidEnrollment: Enrollment = {
      id: makeId("enr"),
      type: "paid",
      date: todayISO(),
      ctvId: trial.ctvId,
      studentId: trial.studentId,
      groupId: paidGroup.id,
      courseType: trial.courseType,
      tuition,
      commissionRateSnapshot: ctv.commissionRate,
      ownerShare: share,
      paymentStatus: "pending",
      note: `Chuyển từ học thử ${trial.id}`,
    };

    const addJob = createJob("add_member", paidGroup.id, student?.gmail);
    const removeJob = createJob("remove_member", trial.groupId, student?.gmail);

    setState((current) => ({
      ...current,
      enrollments: [
        paidEnrollment,
        ...current.enrollments.map((item) =>
          item.id === enrollmentId ? { ...item, trialResult: "da_dang_ky" as const } : item,
        ),
      ],
      jobs: [addJob, removeJob, ...current.jobs],
    }));
    if (student?.gmail) {
      settleMemberJob(addJob.id, apiAddMember(paidGroup.groupEmail, student.gmail, "member"));
      const trialGroup = state.groups.find((item) => item.id === trial.groupId);
      if (trialGroup?.groupEmail) {
        settleMemberJob(removeJob.id, apiRemoveMember(trialGroup.groupEmail, student.gmail));
      }
    }
    setActiveView("students");
  }

  function enqueueGroupJob(enrollment: Enrollment) {
    const student = model.studentMap.get(enrollment.studentId);
    const job = createJob("add_member", enrollment.groupId, student?.gmail);
    setState((current) => ({
      ...current,
      jobs: [job, ...current.jobs],
    }));
    runGroupJob(job);
  }

  async function cancelEnrollment(enrollmentId: string) {
    if (!isAdmin) return;
    const enrollment = state.enrollments.find((item) => item.id === enrollmentId);
    if (!enrollment) return;
    const student = model.studentMap.get(enrollment.studentId);
    const group = resolveEnrollmentGroup(state, enrollment);
    const gmail = student?.gmail.trim().toLowerCase();

    if (!gmail || !group?.groupEmail) {
      setAdminNotice("Không thể hủy đăng ký vì thiếu Gmail học viên hoặc Google Group.");
      return;
    }

    const confirmed = window.confirm(
      `Hủy đăng ký ${gmail} khỏi ${group.name}? Học viên sẽ được xóa khỏi Google Group và toàn bộ doanh thu đã thu của đăng ký này cũng bị gỡ khỏi dòng tiền.`,
    );
    if (!confirmed) return;

    const job = createJob("remove_member", group.id, gmail);
    setState((current) => ({ ...current, jobs: [{ ...job, status: "running" }, ...current.jobs] }));

    try {
      const removal = await apiRemoveMember(group.groupEmail, gmail);
      let trialStatusSynced = true;
      if (enrollment.type === "trial") {
        try {
          await apiUpdateTrialStatus(group.groupEmail, gmail, "khong_dang_ky");
          await loadTrialRecords();
        } catch {
          trialStatusSynced = false;
        }
      }

      // Hủy đăng ký = xóa hẳn bản ghi (kể cả đăng ký trả phí) để doanh thu đã thu
      // cũng được gỡ khỏi dòng tiền / công nợ CTV theo yêu cầu.
      setState((current) => {
        const shouldDecrementCount = !removal.missing;
        const remainingEnrollments = current.enrollments.filter(
          (item) => item.id !== enrollmentId,
        );
        const hasOtherEnrollments = remainingEnrollments.some(
          (item) => item.studentId === enrollment.studentId,
        );

        return {
          ...current,
          // Chỉ còn giữ học viên nếu họ vẫn còn đăng ký khác; nếu không thì xóa luôn.
          students: hasOtherEnrollments
            ? current.students
            : current.students.filter((item) => item.id !== enrollment.studentId),
          enrollments: remainingEnrollments,
          groupMembers: current.groupMembers.filter(
            (member) => !(member.groupId === enrollment.groupId && member.email === gmail),
          ),
          groups: current.groups.map((item) =>
            item.id === enrollment.groupId && typeof item.directMembersCount === "number"
              ? {
                  ...item,
                  directMembersCount: shouldDecrementCount
                    ? Math.max(0, item.directMembersCount - 1)
                    : item.directMembersCount,
                }
              : item,
          ),
          jobs: current.jobs.map((item) =>
            item.id === job.id
              ? { ...item, status: "done", finishedAt: new Date().toISOString(), error: undefined }
              : item,
          ),
        };
      });

      setAdminNotice(
        trialStatusSynced
          ? `Đã xóa ${gmail} khỏi ${group.name} và gỡ doanh thu liên quan khỏi dòng tiền.`
          : `Đã xóa ${gmail} khỏi Google Group và gỡ doanh thu liên quan. Chưa cập nhật được trạng thái học thử đồng bộ.`,
      );
    } catch (error) {
      const message = getErrorMessage(error);
      setState((current) => ({
        ...current,
        jobs: current.jobs.map((item) =>
          item.id === job.id
            ? { ...item, status: "failed", error: message, finishedAt: new Date().toISOString() }
            : item,
        ),
      }));
      setAdminNotice(`Không hủy được đăng ký của ${gmail}: ${message}`);
    }
  }

  async function lockStudentAccess(studentId: string): Promise<ApiLockStudentResult | undefined> {
    if (!isAdmin) return undefined;
    const student = state.students.find((item) => item.id === studentId);
    if (!student) return undefined;

    const enrolledGroupIds = new Set(
      state.enrollments
        .filter((item) => item.studentId === studentId)
        .map((item) => item.groupId),
    );
    const knownGroups = state.groups.filter((group) => enrolledGroupIds.has(group.id));
    const knownGroupText = knownGroups.length
      ? `\n\nNhóm đang ghi nhận:\n${knownGroups.map((group) => `• ${group.name}`).join("\n")}`
      : "";
    const confirmed = window.confirm(
      `Khóa truy cập của ${student.gmail}? Tài khoản sẽ bị gỡ khỏi tất cả Google Group mà học viên đang là thành viên.${knownGroupText}`,
    );
    if (!confirmed) return undefined;

    setAdminNotice(`Đang khóa truy cập của ${student.gmail}…`);
    try {
      const result = await apiLockStudentAccess(student.gmail);
      const removedEmails = new Set(result.removedGroups.map((group) => group.email));
      setState((current) => ({
        ...current,
        groupMembers: current.groupMembers.filter((member) => {
          if (member.email.trim().toLowerCase() !== student.gmail.trim().toLowerCase()) return true;
          const group = current.groups.find((item) => item.id === member.groupId);
          return !group || !removedEmails.has(group.groupEmail.trim().toLowerCase());
        }),
        groups: current.groups.map((group) =>
          removedEmails.has(group.groupEmail.trim().toLowerCase()) &&
          typeof group.directMembersCount === "number"
            ? { ...group, directMembersCount: Math.max(0, group.directMembersCount - 1) }
            : group,
        ),
      }));

      const removedNames = result.removedGroups.map((group) => group.name).join(", ");
      const failureSuffix = result.failedGroups.length
        ? ` Không thu hồi được ${result.failedGroups.length} nhóm.`
        : "";
      setAdminNotice(
        result.removedGroups.length
          ? `Đã khóa ${student.gmail}: gỡ khỏi ${result.removedGroups.length} nhóm${removedNames ? ` (${removedNames})` : ""}.${failureSuffix}`
          : `Không có membership trực tiếp nào của ${student.gmail} trong Google Group.${failureSuffix}`,
      );
      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      setAdminNotice(`Không khóa được ${student.gmail}: ${message}`);
      throw error;
    }
  }

  function retryJob(jobId: string) {
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) return;
    const retry: GroupJob = {
      ...job,
      status: "queued",
      attempts: job.attempts + 1,
      error: undefined,
      finishedAt: undefined,
    };
    setState((current) => ({
      ...current,
      jobs: current.jobs.map((job) =>
        job.id === jobId
          ? retry
          : job,
      ),
    }));
    runGroupJob(retry);
  }

  function completeJob(jobId: string) {
    setState((current) => ({
      ...current,
      jobs: current.jobs.map((job) =>
        job.id === jobId
          ? {
              ...job,
              status: "done",
              finishedAt: new Date().toISOString(),
              error: undefined,
            }
          : job,
      ),
    }));
  }

  function updateCtvRate(ctvId: string, nextRate: number) {
    const safeRate = Number.isFinite(nextRate)
      ? Math.min(1, Math.max(0, nextRate))
      : state.settings.defaultCommissionRate;
    setState((current) => ({
      ...current,
      ctvs: current.ctvs.map((ctv) =>
        ctv.id === ctvId ? { ...ctv, commissionRate: safeRate } : ctv,
      ),
    }));
  }

  function addExpense(input: ExpenseInput) {
    const expense: Expense = {
      ...input,
      id: makeId("exp"),
      amount: Math.max(0, Math.round(input.amount)),
      note: input.note?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    setState((current) => ({
      ...current,
      expenses: [expense, ...current.expenses],
    }));
  }

  function updateExpense(id: string, patch: ExpenseInput) {
    setState((current) => ({
      ...current,
      expenses: current.expenses.map((expense) =>
        expense.id === id
          ? {
              ...expense,
              ...patch,
              amount: Math.max(0, Math.round(patch.amount)),
              note: patch.note?.trim() || undefined,
            }
          : expense,
      ),
    }));
  }

  function removeExpense(id: string) {
    const expense = state.expenses.find((item) => item.id === id);
    if (!expense) return;
    if (!window.confirm(`Xóa khoản chi ${currency(expense.amount)} ngày ${shortDate(expense.date)}?`)) return;
    setState((current) => ({
      ...current,
      expenses: current.expenses.filter((item) => item.id !== id),
    }));
  }

  function addCtv(form: CtvFormState) {
    const nextIndex = state.ctvs.length + 1;
    const code = form.code.trim() || `CTV${String(nextIndex).padStart(3, "0")}`;
    const rate = Number(form.commissionRate);
    const commissionRate = Number.isFinite(rate)
      ? Math.min(1, Math.max(0, rate / 100))
      : state.settings.defaultCommissionRate;

    const ctv: Ctv = {
      id: makeId("ctv"),
      code,
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      commissionRate,
    };
    setState((current) => ({
      ...current,
      ctvs: [...current.ctvs, ctv],
    }));
  }

  function markCtvReceived(ctvId: string) {
    setState((current) => ({
      ...current,
      enrollments: current.enrollments.map((item) =>
        item.ctvId === ctvId && item.type === "paid" && item.paymentStatus === "pending"
          ? { ...item, paymentStatus: "received", paymentReceivedDate: todayISO() }
          : item,
      ),
    }));
  }

  function openEnrollmentModal(nextModal: ModalMode) {
    if (!state.groups.length) {
      setAdminNotice("Chưa có Google Group. Bấm 'Đồng bộ từ Google' trong trang Nhóm trước.");
      setActiveView("students");
      return;
    }
    setModal(nextModal);
  }

  async function addGroup(form: GroupFormState) {
    // Chỉ admin được tạo nhóm. CTV bị chặn (cả UI lẫn handler).
    if (!isAdmin) return;
    const groupEmail = form.groupEmail.trim().toLowerCase();
    const name = form.name.trim();

    // Tạo Google Group THẬT trên Admin SDK trước; chỉ thêm vào state khi thành công.
    setAdminNotice(`Đang tạo nhóm "${name}" trên Google…`);
    let created;
    try {
      created = await apiCreateGroup(groupEmail, name);
    } catch (error) {
      const message = getErrorMessage(error);
      setAdminNotice(`Tạo nhóm thất bại: ${message}`);
      return;
    }

    const emailForId = (created.email || groupEmail).trim().toLowerCase();
    const group: CourseGroup = {
      // Id suy ra từ email (khớp apiGroupToCourseGroup) để đăng ký vẫn liên kết
      // đúng nhóm sau khi "Đồng bộ từ Google" hoặc mở trên máy khác.
      id: `grp-${emailForId}`,
      name: created.name || name,
      groupEmail: created.email || groupEmail,
      subject: form.subject.trim() || name,
      teacher: form.teacher.trim() || "Admin",
      kind: form.kind,
      priceHint: Number(form.priceHint) || 0,
      directMembersCount: created.directMembersCount,
    };
    setState((current) => ({
      ...current,
      groups: [...current.groups, group],
    }));
    setAdminNotice(`Đã tạo nhóm "${group.name}" trên Google.`);
  }

  // Nạp danh sách nhóm THẬT từ Google (Admin SDK) — kèm số thành viên thật.
  async function syncFromGoogle() {
    setAdminNotice("Đang tải nhóm từ Google…");
    try {
      const apiGroups = await fetchGroups();
      const groups = apiGroups.map(apiGroupToCourseGroup);
      setState((current) => ({ ...current, groups, groupMembers: [] }));
      setAdminStatus((current) =>
        current.state === "ready"
          ? { ...current, details: { ...current.details, checkedAt: new Date().toISOString() } }
          : current,
      );
      setAdminNotice(`Đã tải ${groups.length} nhóm từ Google.`);
    } catch (error) {
      const message = getErrorMessage(error);
      setAdminStatus({ state: "error", message, checkedAt: new Date().toISOString() });
      setAdminNotice(`Đồng bộ thất bại: ${message}`);
    }
  }

  // Nạp thành viên thật của 1 nhóm (gọi khi mở "Quản lý thành viên").
  async function loadGroupMembers(group: CourseGroup) {
    void loadTrialRecords(); // làm tươi khóa học thử để bảng thành viên hiển thị đúng
    try {
      const apiMembers = await fetchMembers(group.groupEmail);
      setState((current) => ({
        ...current,
        groupMembers: [
          ...current.groupMembers.filter((m) => m.groupId !== group.id),
          ...apiMembers.map((m) => ({
            id: `mem-${group.id}-${m.email.toLowerCase()}`,
            groupId: group.id,
            email: m.email.toLowerCase(),
            role: roleFromApi(m.role),
            joinDate: "",
          })),
        ],
        groups: current.groups.map((g) =>
          g.id === group.id ? { ...g, directMembersCount: apiMembers.length } : g,
        ),
      }));
    } catch (error) {
      const message = getErrorMessage(error);
      setAdminNotice(`Không tải được thành viên: ${message}`);
    }
  }

  function deleteGroup(groupId: string) {
    // Chỉ admin được xóa nhóm. CTV bị chặn (cả UI lẫn handler).
    if (!isAdmin) return;
    // Chỉ xóa khỏi danh sách hiển thị cục bộ; không xóa nhóm trên Google.
    setState((current) => ({
      ...current,
      groups: current.groups.filter((group) => group.id !== groupId),
      groupMembers: current.groupMembers.filter((member) => member.groupId !== groupId),
    }));
  }

  // Thêm thành viên THẬT qua Admin SDK rồi mới cập nhật state khi thành công.
  // trialCourse có giá trị (hoặc nhóm là "trial") → đi luồng /api/trials để ghi
  // khóa học thử lên Sheet chung (đồng bộ CTV ↔ admin) + gắn email người thêm.
  async function addGroupMember(
    groupId: string,
    email: string,
    name: string,
    role: GroupRole,
    trialCourse?: string,
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    const group = state.groups.find((g) => g.id === groupId);
    if (!group) return;
    const isTrial = group.kind === "trial" || Boolean(trialCourse?.trim());
    const job = createJob("add_member", groupId, normalizedEmail);
    setState((current) => ({ ...current, jobs: [{ ...job, status: "running" }, ...current.jobs] }));
    try {
      let resolvedRole: GroupRole;
      if (isTrial) {
        const { member } = await apiAddTrial(
          group.groupEmail,
          normalizedEmail,
          name,
          trialCourse?.trim() ?? "",
        );
        resolvedRole = roleFromApi(member.role);
        await loadTrialRecords();
      } else {
        const apiMember = await apiAddMember(group.groupEmail, normalizedEmail, role);
        resolvedRole = roleFromApi(apiMember.role);
      }
      setState((current) => {
        const exists = current.groupMembers.some(
          (item) => item.groupId === groupId && item.email === normalizedEmail,
        );
        const member = {
          id: `mem-${groupId}-${normalizedEmail}`,
          groupId,
          email: normalizedEmail,
          name: name.trim() || undefined,
          role: resolvedRole,
          joinDate: todayISO(),
        };
        return {
          ...current,
          groupMembers: exists ? current.groupMembers : [...current.groupMembers, member],
          groups: current.groups.map((g) =>
            g.id === groupId
              ? { ...g, directMembersCount: (g.directMembersCount ?? 0) + (exists ? 0 : 1) }
              : g,
          ),
          jobs: current.jobs.map((j) =>
            j.id === job.id ? { ...j, status: "done", finishedAt: new Date().toISOString() } : j,
          ),
        };
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setState((current) => ({
        ...current,
        jobs: current.jobs.map((j) =>
          j.id === job.id ? { ...j, status: "failed", error: message } : j,
        ),
      }));
      setAdminNotice(`Không thêm được ${normalizedEmail}: ${message}`);
      // Ném lại để modal "Quản lý thành viên" hiển thị lỗi ngay tại chỗ
      // (adminNotice ở trang nền bị modal che, người dùng không thấy).
      throw new Error(message);
    }
  }

  async function removeGroupMember(memberId: string) {
    // Chỉ admin được xóa thành viên. CTV bị chặn (cả UI lẫn handler).
    if (!isAdmin) return;
    const member = state.groupMembers.find((item) => item.id === memberId);
    if (!member) return;
    const group = state.groups.find((g) => g.id === member.groupId);
    if (!group) return;
    const job = createJob("remove_member", member.groupId, member.email);
    setState((current) => ({ ...current, jobs: [{ ...job, status: "running" }, ...current.jobs] }));
    try {
      const removal = await apiRemoveMember(group.groupEmail, member.email);
      setState((current) => ({
        ...current,
        groupMembers: current.groupMembers.filter((item) => item.id !== memberId),
        groups: current.groups.map((g) =>
          g.id === member.groupId
            ? {
                ...g,
                directMembersCount: removal.missing
                  ? g.directMembersCount
                  : Math.max(0, (g.directMembersCount ?? 1) - 1),
              }
            : g,
        ),
        jobs: current.jobs.map((j) =>
          j.id === job.id ? { ...j, status: "done", finishedAt: new Date().toISOString() } : j,
        ),
      }));
    } catch (error) {
      const message = getErrorMessage(error);
      setState((current) => ({
        ...current,
        jobs: current.jobs.map((j) =>
          j.id === job.id ? { ...j, status: "failed", error: message } : j,
        ),
      }));
      setAdminNotice(`Không xóa được ${member.email}: ${message}`);
    }
  }

  async function updateMemberRole(memberId: string, role: GroupRole) {
    const member = state.groupMembers.find((item) => item.id === memberId);
    if (!member || member.role === role) return;
    const group = state.groups.find((g) => g.id === member.groupId);
    if (!group) return;
    const job = createJob("update_role", member.groupId, member.email);
    setState((current) => ({ ...current, jobs: [{ ...job, status: "running" }, ...current.jobs] }));
    try {
      const apiMember = await apiUpdateRole(group.groupEmail, member.email, role);
      setState((current) => ({
        ...current,
        groupMembers: current.groupMembers.map((item) =>
          item.id === memberId ? { ...item, role: roleFromApi(apiMember.role) } : item,
        ),
        jobs: current.jobs.map((j) =>
          j.id === job.id ? { ...j, status: "done", finishedAt: new Date().toISOString() } : j,
        ),
      }));
    } catch (error) {
      const message = getErrorMessage(error);
      setState((current) => ({
        ...current,
        jobs: current.jobs.map((j) =>
          j.id === job.id ? { ...j, status: "failed", error: message } : j,
        ),
      }));
      setAdminNotice(`Không đổi được vai trò: ${message}`);
    }
  }

  function resetAppData() {
    setState(seedState);
    setQuery("");
    setCtvFilter("all");
    setPaymentFilter("all");
    setTrialFilter("all");
    setAdminNotice("");
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
    } catch {
      // Ignore storage cleanup failures; the active state is already reset.
    }
  }

  function resetFilters() {
    setQuery("");
    setCtvFilter("all");
    setPaymentFilter("all");
    setTrialFilter("all");
  }

  const adminWarning = adminStatus.state === "error";
  const editingPaid = editingPaidId
    ? state.enrollments.find((item) => item.id === editingPaidId && item.type === "paid")
    : null;

  // Chọn view từ sheet "Thêm" thì đóng sheet luôn để lộ nội dung vừa mở.
  function openView(view: ViewKey) {
    setActiveView(view);
    setMobileMenuOpen(false);
  }

  // Bấm một nhóm ở sidebar: vào màn Học viên → tab "Theo nhóm" và mở sẵn nhóm đó.
  function openGroupFromSidebar(groupId: string) {
    setActiveView("students");
    setStudentTab("groups");
    setFocusGroupId(groupId);
    setMobileMenuOpen(false);
  }

  // Nhóm hiển thị ở sidebar: admin thấy nhóm học viên (chính), CTV thấy nhóm được cấp.
  const sidebarGroups = (
    isAdmin ? state.groups.filter((group) => !isStudentGroup(group)) : state.groups
  )
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Điều hướng chính">
        <div className="brand">
          <div className="brand-mark">
            <ArenaMark />
          </div>
          <div>
            <strong>Đấu Trường Học Tập</strong>
            <span>{isAdmin ? "Admin console" : "Cộng tác viên"}</span>
          </div>
        </div>
        <nav className="nav-list">
          {visibleNavItems.map((item) => (
            <button
              key={item.key}
              className={activeView === item.key ? "nav-item active" : "nav-item"}
              onClick={() => openView(item.key)}
              aria-current={activeView === item.key ? "page" : undefined}
              type="button"
            >
              <item.icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-groups">
          <div className="sidebar-groups-head">
            <span>Nhóm khóa học</span>
            <span className="sidebar-groups-count">{sidebarGroups.length}</span>
          </div>
          {sidebarGroups.length ? (
            <div className="sidebar-groups-list">
              {sidebarGroups.map((group) => {
                const active = activeView === "students" && studentTab === "groups" && focusGroupId === group.id;
                const count = group.directMembersCount ?? memberCount(state, group.id);
                return (
                  <button
                    key={group.id}
                    className={active ? "sidebar-group-item active" : "sidebar-group-item"}
                    type="button"
                    onClick={() => openGroupFromSidebar(group.id)}
                    title={group.groupEmail}
                  >
                    <span className="sidebar-group-name">{group.name}</span>
                    <span className="sidebar-group-count">{count}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="sidebar-groups-empty">
              {isAdmin ? "Chưa có nhóm. Đồng bộ từ Google trong tab Theo nhóm." : "Chưa được cấp nhóm nào."}
            </p>
          )}
        </div>

        {isAdmin ? <AdminStatusCard status={adminStatus} /> : null}
        <UserCard session={session} />
      </aside>

      <main className="main" id="main-content">
        <header className="topbar">
          {isAdmin ? (
            <div className="search-box">
              <Search size={18} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm kiếm học viên, CTV, giao dịch, nhóm..."
                aria-label="Tìm kiếm dữ liệu"
              />
            </div>
          ) : (
            <div className="topbar-title">
              <strong>Nhóm của tôi</strong>
              <span>Quản lý thành viên các nhóm bạn được cấp quyền.</span>
            </div>
          )}
          <div className="topbar-actions">
            {isAdmin ? (
              <>
                <button
                  className="icon-button"
                  title="Xóa bộ lọc"
                  aria-label="Xóa bộ lọc"
                  type="button"
                  onClick={resetFilters}
                >
                  <Filter size={18} aria-hidden="true" />
                </button>
                <button
                  className="button secondary mobile-cashflow-button"
                  type="button"
                  onClick={() => setActiveView("cashflow")}
                >
                  <TrendingUp size={17} />
                  <span>Dòng tiền</span>
                </button>
                <button className="button secondary" type="button" onClick={() => openEnrollmentModal("trial")}>
                  <FlaskConical size={17} />
                  <span>Thêm học thử</span>
                </button>
                <button className="button primary" type="button" onClick={() => openEnrollmentModal("transaction")}>
                  <Plus size={17} />
                  <span>Thêm giao dịch</span>
                </button>
              </>
            ) : null}
            <a className="button ghost" href="/api/auth/logout" title="Đăng xuất" aria-label="Đăng xuất">
              <LogOut size={17} aria-hidden="true" />
              <span>Đăng xuất</span>
            </a>
          </div>
        </header>

        {isAdmin && adminWarning ? (
          <div className="alert-strip">
            <AlertTriangle size={18} />
            <span>Admin SDK chưa sẵn sàng: {adminStatus.message}</span>
            <button type="button" onClick={() => setActiveView("settings")}>
              Mở cài đặt
            </button>
          </div>
        ) : null}

        {isAdmin &&
        adminNotice &&
        adminNotice !==
          (adminStatus.state === "error" ? `Admin SDK chưa sẵn sàng: ${adminStatus.message}` : "") ? (
          <div className="alert-strip app-notice" role="status" aria-live="polite">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{adminNotice}</span>
            <button type="button" onClick={() => setAdminNotice("")}>
              Đóng
            </button>
          </div>
        ) : null}

        <section className="content-stack">
          {activeView === "students" ? (
            <StudentWorkspace
              isAdmin={isAdmin}
              state={state}
              model={model}
              filteredPaid={filteredPaid}
              filteredTrials={filteredTrials}
              trialRecords={trialRecords}
              ctvFilter={ctvFilter}
              paymentFilter={paymentFilter}
              trialFilter={trialFilter}
              domainMembers={domainMembers}
              onCtvFilter={setCtvFilter}
              onPaymentFilter={setPaymentFilter}
              onTrialFilter={setTrialFilter}
              onTogglePayment={togglePayment}
              onEnqueueJob={enqueueGroupJob}
              onChangeCtv={changeEnrollmentCtv}
              onEditTransaction={setEditingPaidId}
              onCancelEnrollment={cancelEnrollment}
              onUpdateResult={updateTrialResult}
              onConvertTrial={convertTrial}
              onUpdateServerStatus={updateServerTrialStatus}
              onLockStudent={lockStudentAccess}
              onAddGroup={addGroup}
              onDeleteGroup={deleteGroup}
              onSyncFromGoogle={syncFromGoogle}
              onOpenGroup={loadGroupMembers}
              onAddMember={addGroupMember}
              onRemoveMember={removeGroupMember}
              onUpdateRole={updateMemberRole}
              tab={studentTab}
              onTabChange={setStudentTab}
              focusGroupId={focusGroupId}
              onFocusGroupHandled={() => setFocusGroupId(null)}
            />
          ) : null}

          {activeView === "cashflow" ? (
            <CashflowView
              state={state}
              onAddExpense={addExpense}
              onUpdateExpense={updateExpense}
              onRemoveExpense={removeExpense}
            />
          ) : null}

          {activeView === "ctv" ? (
            <CtvView
              state={state}
              model={model}
              trialRecords={trialRecords}
              onAddCtv={addCtv}
              onRateChange={updateCtvRate}
              onMarkReceived={markCtvReceived}
            />
          ) : null}

          {activeView === "settings" ? (
            <SettingsView
              state={state}
              adminStatus={adminStatus}
              activityJobs={ctvActivityJobs}
              onReset={resetAppData}
              onRefreshAdminStatus={refreshAdminStatus}
              onRefreshJobs={loadCtvActivityJobs}
              onRetryJob={retryJob}
              onCompleteJob={completeJob}
              adminNotice={adminNotice}
            />
          ) : null}
        </section>
      </main>

      <nav
        className="mobile-nav"
        aria-label="Điều hướng mobile"
        style={{ gridTemplateColumns: `repeat(${mobileBarItems.length + 1}, minmax(0, 1fr))` }}
      >
        {mobileBarItems.map((item) => (
          <button
            key={item.key}
            className={activeView === item.key ? "mobile-nav-item active" : "mobile-nav-item"}
            onClick={() => openView(item.key)}
            aria-current={activeView === item.key ? "page" : undefined}
            type="button"
          >
            <item.icon size={19} aria-hidden="true" />
            <span>{item.shortLabel ?? item.label}</span>
          </button>
        ))}
        <button
          className={
            mobileMenuOpen || mobileSheetItems.some((item) => item.key === activeView)
              ? "mobile-nav-item active"
              : "mobile-nav-item"
          }
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-expanded={mobileMenuOpen}
          aria-haspopup="menu"
          type="button"
        >
          <MoreHorizontal size={19} aria-hidden="true" />
          <span>Thêm</span>
        </button>
      </nav>

      {mobileMenuOpen ? (
        <MobileMoreSheet
          items={mobileSheetItems}
          activeView={activeView}
          session={session}
          isAdmin={isAdmin}
          onSelect={openView}
          onClose={() => setMobileMenuOpen(false)}
        />
      ) : null}

      {modal ? (
        <EnrollmentModal
          state={state}
          initialType={modal === "trial" ? "trial" : "paid"}
          domainMembers={domainMembers}
          onClose={() => setModal(null)}
          onSubmitPaid={addPaidEnrollment}
          onSubmitTrial={addTrialEnrollment}
        />
      ) : null}

      {editingPaid ? (
        <EditTransactionModal
          enrollment={editingPaid}
          state={state}
          domainMembers={domainMembers}
          onClose={() => setEditingPaidId(null)}
          onSubmit={updatePaidEnrollment}
        />
      ) : null}
    </div>
  );
}

type StudentTab = "paid" | "trial" | "students" | "groups";

// Workspace "Học viên" gộp toàn bộ thao tác liên quan học viên vào 1 màn, chia
// tab con: đăng ký chính thức, học thử, danh sách HV, và quản lý theo nhóm.
// CTV chỉ thấy tab "Nhóm của tôi".
function StudentWorkspace({
  isAdmin,
  state,
  model,
  filteredPaid,
  filteredTrials,
  trialRecords,
  ctvFilter,
  paymentFilter,
  trialFilter,
  domainMembers,
  onCtvFilter,
  onPaymentFilter,
  onTrialFilter,
  onTogglePayment,
  onEnqueueJob,
  onChangeCtv,
  onEditTransaction,
  onCancelEnrollment,
  onUpdateResult,
  onConvertTrial,
  onUpdateServerStatus,
  onLockStudent,
  onAddGroup,
  onDeleteGroup,
  onSyncFromGoogle,
  onOpenGroup,
  onAddMember,
  onRemoveMember,
  onUpdateRole,
  tab,
  onTabChange,
  focusGroupId,
  onFocusGroupHandled,
}: {
  isAdmin: boolean;
  state: AppState;
  model: ReturnType<typeof buildModelShape>;
  filteredPaid: Enrollment[];
  filteredTrials: Enrollment[];
  trialRecords: TrialRecord[];
  ctvFilter: string;
  paymentFilter: "all" | PaymentStatus;
  trialFilter: "all" | TrialResult;
  domainMembers: DomainMember[];
  onCtvFilter: (id: string) => void;
  onPaymentFilter: (status: "all" | PaymentStatus) => void;
  onTrialFilter: (status: "all" | TrialResult) => void;
  onTogglePayment: (id: string) => void;
  onEnqueueJob: (enrollment: Enrollment) => void;
  onChangeCtv: (enrollmentId: string, ctvEmail: string) => void;
  onEditTransaction: (id: string) => void;
  onCancelEnrollment: (id: string) => void;
  onUpdateResult: (id: string, result: TrialResult) => void;
  onConvertTrial: (id: string) => void;
  onUpdateServerStatus: (groupEmail: string, email: string, status: TrialStatus) => void;
  onLockStudent: (studentId: string) => Promise<ApiLockStudentResult | undefined>;
  onAddGroup: (form: GroupFormState) => void;
  onDeleteGroup: (groupId: string) => void;
  onSyncFromGoogle: () => void;
  onOpenGroup: (group: CourseGroup) => void;
  onAddMember: (
    groupId: string,
    email: string,
    name: string,
    role: GroupRole,
    trialCourse?: string,
  ) => Promise<void>;
  onRemoveMember: (memberId: string) => void;
  onUpdateRole: (memberId: string, role: GroupRole) => void;
  tab: StudentTab;
  onTabChange: (tab: StudentTab) => void;
  focusGroupId: string | null;
  onFocusGroupHandled: () => void;
}) {
  if (!isAdmin) {
    return (
      <GroupsView
        state={state}
        isAdmin={isAdmin}
        studentGroupsOnly={false}
        trialRecords={trialRecords}
        onAddGroup={onAddGroup}
        onDeleteGroup={onDeleteGroup}
        onSyncFromGoogle={onSyncFromGoogle}
        onOpenGroup={onOpenGroup}
        onAddMember={onAddMember}
        onRemoveMember={onRemoveMember}
        onUpdateRole={onUpdateRole}
        focusGroupId={focusGroupId}
        onFocusGroupHandled={onFocusGroupHandled}
      />
    );
  }

  return (
    <>
      <div className="workspace-tabs">
        <Segmented
          value={tab}
          options={[
            { value: "paid", label: "Chính thức" },
            { value: "trial", label: "Học thử" },
            { value: "students", label: "Danh sách HV" },
            { value: "groups", label: "Theo nhóm" },
          ]}
          onChange={(value) => onTabChange(value as StudentTab)}
        />
      </div>

      {tab === "paid" ? (
        <TransactionsView
          state={state}
          rows={filteredPaid}
          ctvFilter={ctvFilter}
          paymentFilter={paymentFilter}
          onCtvFilter={onCtvFilter}
          onPaymentFilter={onPaymentFilter}
          onTogglePayment={onTogglePayment}
          onEnqueueJob={onEnqueueJob}
          onChangeCtv={onChangeCtv}
          onEditTransaction={onEditTransaction}
          onCancelEnrollment={onCancelEnrollment}
          domainMembers={domainMembers}
        />
      ) : null}

      {tab === "trial" ? (
        <TrialsView
          state={state}
          rows={filteredTrials}
          trialRecords={trialRecords}
          ctvFilter={ctvFilter}
          trialFilter={trialFilter}
          onCtvFilter={onCtvFilter}
          onTrialFilter={onTrialFilter}
          onUpdateResult={onUpdateResult}
          onConvertTrial={onConvertTrial}
          onUpdateServerStatus={onUpdateServerStatus}
          onCancelEnrollment={onCancelEnrollment}
        />
      ) : null}

      {tab === "students" ? (
        <StudentsView state={state} onCancelEnrollment={onCancelEnrollment} onLockStudent={onLockStudent} />
      ) : null}

      {tab === "groups" ? (
        <GroupsView
          state={state}
          isAdmin={isAdmin}
          studentGroupsOnly={false}
          trialRecords={trialRecords}
          onAddGroup={onAddGroup}
          onDeleteGroup={onDeleteGroup}
          onSyncFromGoogle={onSyncFromGoogle}
          onOpenGroup={onOpenGroup}
          onAddMember={onAddMember}
          onRemoveMember={onRemoveMember}
          onUpdateRole={onUpdateRole}
          focusGroupId={focusGroupId}
          onFocusGroupHandled={onFocusGroupHandled}
        />
      ) : null}
    </>
  );
}

function TransactionsView({
  state,
  rows,
  ctvFilter,
  paymentFilter,
  onCtvFilter,
  onPaymentFilter,
  onTogglePayment,
  onEnqueueJob,
  onChangeCtv,
  onEditTransaction,
  onCancelEnrollment,
  domainMembers,
}: {
  state: AppState;
  rows: Enrollment[];
  ctvFilter: string;
  paymentFilter: "all" | PaymentStatus;
  onChangeCtv: (enrollmentId: string, ctvEmail: string) => void;
  domainMembers: DomainMember[];
  onCtvFilter: (id: string) => void;
  onPaymentFilter: (status: "all" | PaymentStatus) => void;
  onTogglePayment: (id: string) => void;
  onEnqueueJob: (enrollment: Enrollment) => void;
  onEditTransaction: (id: string) => void;
  onCancelEnrollment: (id: string) => void;
}) {
  const cash = rows.reduce(
    (acc, item) => {
      acc.tuition += item.tuition;
      acc.expected += item.ownerShare;
      if (item.paymentStatus === "received") acc.received += item.ownerShare;
      return acc;
    },
    { tuition: 0, expected: 0, received: 0 },
  );
  const debt = cash.expected - cash.received;

  return (
    <>
      <PageTitle
        title="Giao dịch"
        subtitle="Theo dõi đăng ký trả phí, snapshot hoa hồng và tiền CTV đã chuyển."
      />
      <div className="metric-grid cash-metric-grid">
        <MetricCard label="Doanh số" value={currency(cash.tuition)} icon={ReceiptText} tone="slate" />
        <MetricCard label="Anh nhận" value={currency(cash.expected)} icon={CircleDollarSign} tone="blue" />
        <MetricCard label="Đã thu" value={currency(cash.received)} icon={CheckCircle2} tone="green" />
        <MetricCard label="Còn nợ" value={currency(debt)} icon={WalletCards} tone="amber" />
      </div>
      <FilterBar
        state={state}
        ctvFilter={ctvFilter}
        onCtvFilter={onCtvFilter}
        right={
          <Segmented
            value={paymentFilter}
            options={[
              { value: "all", label: "Tất cả" },
              { value: "pending", label: "Chưa trả" },
              { value: "received", label: "Đã trả" },
            ]}
            onChange={(value) => onPaymentFilter(value as "all" | PaymentStatus)}
          />
        }
      />
      <section className="panel">
        <DataTable>
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Gmail học viên</th>
              <th>CTV</th>
              <th>Môn/Combo</th>
              <th className="numeric">Học phí</th>
              <th className="numeric">Anh nhận</th>
              <th>Tiền</th>
              <th>Google Group</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((item) => (
                <TransactionRow
                  key={item.id}
                  enrollment={item}
                  state={state}
                  onTogglePayment={onTogglePayment}
                  onEnqueueJob={onEnqueueJob}
                  onChangeCtv={onChangeCtv}
                  onEditTransaction={onEditTransaction}
                  onCancelEnrollment={onCancelEnrollment}
                  domainMembers={domainMembers}
                />
              ))
            ) : (
              <EmptyTableRow colSpan={9} label="Chưa có giao dịch nào." />
            )}
          </tbody>
        </DataTable>
      </section>
    </>
  );
}

// Tải một file CSV ngay trên trình duyệt. BOM ﻿ để Excel đọc đúng tiếng Việt.
function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const escapeCell = (value: string | number) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
  const blob = new Blob([`﻿${body}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Xuất 2 file: thu học phí (mọi đăng ký trả phí) và khoản chi.
function exportCashflowCsv(state: AppState) {
  const studentMap = byId(state.students);
  const ctvMap = byId(state.ctvs);
  const groupMap = byId(state.groups);

  const income: Array<Array<string | number>> = [
    ["Ngày", "Học viên", "Khóa", "CTV", "Học phí", "Anh nhận", "Trạng thái", "Ngày thu", "Đã rời khóa"],
  ];
  for (const item of state.enrollments) {
    if (item.type !== "paid") continue;
    income.push([
      shortDate(item.date),
      studentMap.get(item.studentId)?.gmail ?? "",
      groupMap.get(item.groupId)?.name ?? item.courseType,
      ctvMap.get(item.ctvId)?.name ?? "",
      item.tuition,
      item.ownerShare,
      item.paymentStatus === "received" ? "Đã thu" : "Chờ thu",
      item.paymentReceivedDate ? shortDate(item.paymentReceivedDate) : "",
      item.removedAt ? shortDate(item.removedAt) : "",
    ]);
  }

  const expenses: Array<Array<string | number>> = [["Ngày", "Danh mục", "Số tiền", "Ghi chú"]];
  for (const item of state.expenses ?? []) {
    expenses.push([shortDate(item.date), expenseCategoryLabel(item.category), item.amount, item.note ?? ""]);
  }

  const stamp = todayISO();
  downloadCsv(`thu-hoc-phi-${stamp}.csv`, income);
  downloadCsv(`khoan-chi-${stamp}.csv`, expenses);
}

function CashflowView({
  state,
  onAddExpense,
  onUpdateExpense,
  onRemoveExpense,
}: {
  state: AppState;
  onAddExpense: (input: ExpenseInput) => void;
  onUpdateExpense: (id: string, input: ExpenseInput) => void;
  onRemoveExpense: (id: string) => void;
}) {
  const [granularity, setGranularity] = useState<CashflowGranularity>("day");
  const [expenseModal, setExpenseModal] = useState<Expense | "new" | null>(null);
  const series = useMemo(() => cashflowSeries(state, granularity), [state, granularity]);
  const summary = useMemo(() => financeSummary(state), [state]);
  // Công nợ = tiền anh nhận đã ghi nhận nhưng học viên chưa nộp (paymentStatus pending).
  const pending = useMemo(
    () =>
      paidEnrollments(state)
        .filter((item) => item.paymentStatus === "pending")
        .reduce((sum, item) => sum + item.ownerShare, 0),
    [state],
  );
  const cumulative = series.at(-1)?.cumulative ?? 0;
  const granLabel = granularity === "day" ? "ngày" : granularity === "week" ? "tuần" : "tháng";
  // Theo ngày: 30 ngày gần nhất (1 tháng) để thấy xu hướng dài hơn; nhãn tự thưa ra cho gọn.
  const chartCount = granularity === "day" ? 30 : 12;
  const visibleCategoryRows = summary.byCategory.filter((item) => item.amount > 0);
  const sortedExpenses = useMemo(
    () =>
      [...state.expenses].sort(
        (a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
      ),
    [state.expenses],
  );

  return (
    <>
      <div className="page-heading cashflow-heading">
        <div>
          <h1>Dòng tiền</h1>
          <p>Theo dõi tiền thực nhận, chi phí vận hành và số dư trên cơ sở thu chi thực tế.</p>
        </div>
        <div className="cashflow-heading-actions">
          <Segmented
            value={granularity}
            options={[
              { value: "day", label: "Ngày" },
              { value: "week", label: "Tuần" },
              { value: "month", label: "Tháng" },
            ]}
            onChange={(value) => setGranularity(value as CashflowGranularity)}
          />
          <button
            className="button secondary"
            type="button"
            onClick={() => exportCashflowCsv(state)}
            title="Tải file CSV thu học phí và khoản chi (mở được bằng Excel)"
          >
            <Save size={17} />
            <span>Xuất CSV</span>
          </button>
        </div>
      </div>

      <div className="metric-grid cash-metric-grid">
        <MetricCard label="Đã thu" value={currency(summary.income)} icon={CheckCircle2} tone="green" />
        <MetricCard label="Chờ thu" value={currency(pending)} icon={Clock3} tone="amber" negative={pending > 0} />
        <MetricCard label="Tổng chi" value={currency(summary.expense)} icon={ReceiptText} tone="slate" />
        <MetricCard
          label="Dòng tiền ròng"
          value={currency(summary.net)}
          icon={TrendingUp}
          tone="blue"
          negative={summary.net < 0}
        />
        <MetricCard
          label="Số dư lũy kế"
          value={currency(cumulative)}
          icon={WalletCards}
          tone="slate"
          negative={cumulative < 0}
        />
      </div>

      <div className="dashboard-grid cashflow-overview-grid">
        <section className="panel span-8">
          <PanelHeader
            title={`Thu · chi · ròng theo ${granLabel}`}
            action={series.length > chartCount ? `${chartCount} ${granLabel} gần nhất` : `${series.length} ${granLabel}`}
          />
          <CashflowChart data={series.slice(-chartCount)} />
        </section>

        <section className="panel span-4">
          <PanelHeader title="Cơ cấu chi" action={currency(summary.expense)} />
          {visibleCategoryRows.length ? (
            <div className="expense-breakdown">
              {visibleCategoryRows.map((item) => {
                const percent = summary.expense > 0 ? (item.amount / summary.expense) * 100 : 0;
                return (
                  <div className="expense-category-row" key={item.category}>
                    <div>
                      <strong>{expenseCategoryLabel(item.category)}</strong>
                      <span>{currency(item.amount)}</span>
                    </div>
                    <div className="expense-category-track" aria-hidden="true">
                      <span style={{ width: `${percent}%` }} />
                    </div>
                    <small>{percent.toFixed(percent >= 10 ? 0 : 1)}%</small>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState label="Chưa có khoản chi." />
          )}
        </section>
      </div>

      <section className="panel">
        <PanelHeader
          title="Dòng tiền theo kỳ"
          action={
            granularity === "day"
              ? "Theo từng ngày"
              : granularity === "week"
                ? "Tuần bắt đầu từ Thứ 2"
                : "Theo tháng"
          }
        />
        <DataTable className="cashflow-period-table">
          <thead>
            <tr>
              <th>Kỳ</th>
              <th className="numeric">Thu</th>
              <th className="numeric">Chi</th>
              <th className="numeric">Ròng</th>
              <th className="numeric">Lũy kế</th>
            </tr>
          </thead>
          <tbody>
            {series.length ? (
              [...series].reverse().map((item) => (
                <tr key={item.key}>
                  <td data-label="Kỳ"><strong>{item.label}</strong></td>
                  <td data-label="Thu" className="numeric money-cell cashflow-income">{currency(item.income)}</td>
                  <td data-label="Chi" className="numeric money-cell cashflow-expense">{currency(item.expense)}</td>
                  <td data-label="Ròng" className={`numeric money-cell ${item.net < 0 ? "negative" : "cashflow-net"}`}>
                    {currency(item.net)}
                  </td>
                  <td data-label="Lũy kế" className={`numeric money-cell ${item.cumulative < 0 ? "negative" : ""}`}>
                    {currency(item.cumulative)}
                  </td>
                </tr>
              ))
            ) : (
              <EmptyTableRow colSpan={5} label="Chưa có dòng tiền trong kỳ." />
            )}
          </tbody>
        </DataTable>
      </section>

      <section className="panel">
        <div className="panel-header expense-panel-header">
          <div>
            <h2>Khoản chi</h2>
            <span>{state.expenses.length} khoản đã ghi nhận</span>
          </div>
          <button className="button primary" type="button" onClick={() => setExpenseModal("new")}>
            <Plus size={17} />
            <span>Thêm khoản chi</span>
          </button>
        </div>
        <DataTable className="expense-table">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Danh mục</th>
              <th className="numeric">Số tiền</th>
              <th>Ghi chú</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedExpenses.length ? (
              sortedExpenses.map((expense) => (
                <tr key={expense.id}>
                  <td data-label="Ngày">{shortDate(expense.date)}</td>
                  <td data-label="Danh mục"><StatusBadge variant="warning">{expenseCategoryLabel(expense.category)}</StatusBadge></td>
                  <td data-label="Số tiền" className="numeric money-cell cashflow-expense">{currency(expense.amount)}</td>
                  <td data-label="Ghi chú">{expense.note || "-"}</td>
                  <td className="row-actions">
                    <button className="mini-button" type="button" onClick={() => setExpenseModal(expense)}>
                      <Pencil size={14} /> Sửa
                    </button>
                    <button className="mini-button danger" type="button" onClick={() => onRemoveExpense(expense.id)}>
                      <Trash2 size={14} /> Xóa
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyTableRow colSpan={5} label="Chưa có khoản chi. Thêm khoản đầu tiên để tính dòng tiền ròng." />
            )}
          </tbody>
        </DataTable>
      </section>

      {expenseModal ? (
        <ExpenseModal
          expense={expenseModal === "new" ? undefined : expenseModal}
          onClose={() => setExpenseModal(null)}
          onSubmit={(input) => {
            if (expenseModal === "new") onAddExpense(input);
            else onUpdateExpense(expenseModal.id, input);
            setExpenseModal(null);
          }}
        />
      ) : null}
    </>
  );
}

// Rút gọn số tiền cho nhãn trục: 12,5 tr · 800 k · 0 (không kèm "đ" cho gọn).
function cfCompactMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tỷ`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tr`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)} k`;
  return `${sign}${abs}`;
}

// Làm tròn "đẹp" lên bội số 1·2·5 để chia lưới trục cho gọn mắt.
function cfNiceCeil(value: number): number {
  if (value <= 0) return 0;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const frac = value / base;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return step * base;
}

function CashflowChart({
  data,
}: {
  data: Array<{ key: string; label: string; income: number; expense: number; net: number; cumulative: number }>;
}) {
  const [active, setActive] = useState<number | null>(null);

  if (!data.length) return <EmptyState label="Chưa có dữ liệu để vẽ biểu đồ." />;

  // Không gian vẽ (đơn vị SVG). Chừa lề trái cho nhãn trục tiền.
  const W = 760;
  const H = 300;
  const mLeft = 52;
  const mRight = 14;
  const mTop = 16;
  const mBottom = 26;
  const plotLeft = mLeft;
  const plotRight = W - mRight;
  const plotTop = mTop;
  const plotBottom = H - mBottom;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const rawMax = Math.max(...data.flatMap((item) => [item.income, item.expense, item.net]), 0);
  const rawMin = Math.min(...data.map((item) => item.net), 0);
  const niceMax = cfNiceCeil(rawMax) || 1;
  const niceMin = rawMin < 0 ? -cfNiceCeil(-rawMin) : 0;
  const span = Math.max(niceMax - niceMin, 1);
  const y = (value: number) => plotTop + ((niceMax - value) / span) * plotH;
  const zeroY = y(0);

  // Mốc lưới: chia đều từ min→max, luôn đi qua 0.
  const tickCount = 4;
  const ticks: number[] = [];
  for (let i = 0; i <= tickCount; i++) ticks.push(niceMin + (span * i) / tickCount);

  const slotW = plotW / data.length;
  const centers = data.map((_, index) => plotLeft + slotW * (index + 0.5));
  const groupW = Math.min(slotW * 0.62, 40);
  const barW = Math.max(groupW / 2 - 1.5, 2);

  const netPoints = data.map((item, index) => `${centers[index].toFixed(1)},${y(item.net).toFixed(1)}`).join(" ");

  // Nhãn ngày thưa ra để trục dưới không chật.
  const labelStep = Math.max(1, Math.ceil(data.length / 12));
  const activeItem = active != null ? data[active] : null;
  const tooltipLeft = active != null ? Math.min(Math.max((centers[active] / W) * 100, 16), 84) : 50;

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relX = ((event.clientX - rect.left) / rect.width) * W;
    const index = Math.round((relX - plotLeft) / slotW - 0.5);
    setActive(Math.min(Math.max(index, 0), data.length - 1));
  };

  return (
    <div className="cf-chart">
      <div className="cf-plot" onMouseMove={onMove} onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Biểu đồ thu, chi và dòng tiền ròng theo kỳ">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={plotLeft} x2={plotRight} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "cf-axis" : "cf-grid"} />
              <text x={plotLeft - 8} y={y(tick)} className="cf-ytick" dominantBaseline="middle" textAnchor="end">
                {cfCompactMoney(tick)}
              </text>
            </g>
          ))}

          {active != null ? (
            <line x1={centers[active]} x2={centers[active]} y1={plotTop} y2={plotBottom} className="cf-guide" />
          ) : null}

          {data.map((item, index) => {
            const incomeY = y(item.income);
            const expenseY = y(item.expense);
            const isActive = index === active;
            return (
              <g key={item.key} className={isActive ? "cf-col active" : "cf-col"}>
                <rect
                  x={centers[index] - barW - 1}
                  y={Math.min(incomeY, zeroY)}
                  width={barW}
                  height={Math.max(Math.abs(zeroY - incomeY), 1)}
                  rx="2"
                  className="cf-income"
                />
                <rect
                  x={centers[index] + 1}
                  y={Math.min(expenseY, zeroY)}
                  width={barW}
                  height={Math.max(Math.abs(zeroY - expenseY), 1)}
                  rx="2"
                  className="cf-expense"
                />
              </g>
            );
          })}

          <polyline points={netPoints} className="cf-net" vectorEffect="non-scaling-stroke" />
          {activeItem ? (
            <circle cx={centers[active as number]} cy={y(activeItem.net)} r="4.5" className="cf-net-dot" />
          ) : null}
        </svg>

        {activeItem ? (
          <div className="cf-tooltip" style={{ left: `${tooltipLeft}%` }} aria-hidden="true">
            <strong>{activeItem.label}</strong>
            <span className="cf-tt-row"><i className="income" />Thu<b>{currency(activeItem.income)}</b></span>
            <span className="cf-tt-row"><i className="expense" />Chi<b>{currency(activeItem.expense)}</b></span>
            <span className="cf-tt-row"><i className="net" />Ròng<b className={activeItem.net < 0 ? "neg" : ""}>{currency(activeItem.net)}</b></span>
            <span className="cf-tt-cum">Lũy kế {currency(activeItem.cumulative)}</span>
          </div>
        ) : null}
      </div>

      <div className="cf-xaxis" aria-hidden="true">
        {data.map((item, index) => (
          <span key={item.key} className={index === active ? "active" : undefined}>
            {index % labelStep === 0 || index === data.length - 1 ? item.label : ""}
          </span>
        ))}
      </div>

      <div className="cf-legend" aria-label="Chú giải biểu đồ">
        <span><i className="income" /> Thu</span>
        <span><i className="expense" /> Chi</span>
        <span><i className="net" /> Ròng</span>
      </div>
    </div>
  );
}

function TrialsView({
  state,
  rows,
  trialRecords,
  ctvFilter,
  trialFilter,
  onCtvFilter,
  onTrialFilter,
  onUpdateResult,
  onConvertTrial,
  onUpdateServerStatus,
  onCancelEnrollment,
}: {
  state: AppState;
  rows: Enrollment[];
  trialRecords: TrialRecord[];
  ctvFilter: string;
  trialFilter: "all" | TrialResult;
  onCtvFilter: (id: string) => void;
  onTrialFilter: (status: "all" | TrialResult) => void;
  onUpdateResult: (id: string, result: TrialResult) => void;
  onConvertTrial: (id: string) => void;
  onUpdateServerStatus: (groupEmail: string, email: string, status: TrialStatus) => void;
  onCancelEnrollment: (id: string) => void;
}) {
  const studentMap = byId(state.students);
  const ctvMap = byId(state.ctvs);

  return (
    <>
      <PageTitle
        title="Học thử"
        subtitle="Quản lý học thử, kết quả chuyển đổi và việc xóa khỏi nhóm học thử khi cần."
      />

      <section className="panel">
        <PanelHeader
          title="Học thử đồng bộ (CTV ↔ Admin)"
          action={`${trialRecords.length} bản ghi từ Google Sheet`}
        />
        <DataTable>
          <thead>
            <tr>
              <th>Học viên</th>
              <th>Khóa học thử</th>
              <th>CTV (email)</th>
              <th>Nhóm</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {trialRecords.length ? (
              trialRecords.map((record) => (
                <tr key={`${record.groupEmail}-${record.studentEmail}`}>
                  <td>
                    <strong>{record.studentEmail}</strong>
                    <span className="table-subtext">{record.studentName || "-"}</span>
                  </td>
                  <td>{record.trialCourse || "-"}</td>
                  <td>{record.ctvEmail || "-"}</td>
                  <td>{record.groupEmail}</td>
                  <td>
                    <select
                      className="select compact"
                      value={
                        ["dang_thu", "da_dang_ky", "khong_dang_ky"].includes(record.status)
                          ? record.status
                          : "dang_thu"
                      }
                      onChange={(event) =>
                        onUpdateServerStatus(
                          record.groupEmail,
                          record.studentEmail,
                          event.target.value as TrialStatus,
                        )
                      }
                      aria-label={`Cập nhật trạng thái học thử của ${record.studentEmail}`}
                    >
                      <option value="dang_thu">Đang thử</option>
                      <option value="da_dang_ky">Đã đăng ký</option>
                      <option value="khong_dang_ky">Không đăng ký</option>
                    </select>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyTableRow
                colSpan={5}
                label="Chưa có học thử đồng bộ. CTV thêm học viên kèm 'Khóa học thử' sẽ hiện ở đây."
              />
            )}
          </tbody>
        </DataTable>
      </section>
      <FilterBar
        state={state}
        ctvFilter={ctvFilter}
        onCtvFilter={onCtvFilter}
        right={
          <Segmented
            value={trialFilter}
            options={[
              { value: "all", label: "Tất cả" },
              { value: "dang_thu", label: "Đang thử" },
              { value: "da_dang_ky", label: "Đã đăng ký" },
              { value: "khong_dang_ky", label: "Không đăng ký" },
            ]}
            onChange={(value) => onTrialFilter(value as "all" | TrialResult)}
          />
        }
      />
      <section className="panel">
        <DataTable>
          <thead>
            <tr>
              <th>Ngày thử</th>
              <th>Gmail học viên</th>
              <th>CTV</th>
              <th>Môn/Combo</th>
              <th>Hết hạn</th>
              <th>Kết quả</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((item) => {
                const student = studentMap.get(item.studentId);
                const ctv = ctvMap.get(item.ctvId);
                return (
                  <tr key={item.id}>
                    <td>{shortDate(item.date)}</td>
                    <td>
                      <strong>{student?.gmail}</strong>
                      <span className="table-subtext">{student?.name}</span>
                    </td>
                    <td>{ctv?.name}</td>
                    <td>{item.courseType}</td>
                    <td>{item.trialEndDate ? shortDate(item.trialEndDate) : "Chưa đặt"}</td>
                    <td>
                      <select
                        className="select compact"
                        value={item.trialResult ?? "dang_thu"}
                        onChange={(event) => onUpdateResult(item.id, event.target.value as TrialResult)}
                        aria-label="Cập nhật kết quả học thử"
                      >
                        <option value="dang_thu">Đang thử</option>
                        <option value="da_dang_ky">Đã đăng ký</option>
                        <option value="khong_dang_ky">Không đăng ký</option>
                      </select>
                    </td>
                    <td className="row-actions">
                      <button className="mini-button" type="button" onClick={() => onConvertTrial(item.id)}>
                        Chuyển trả phí
                      </button>
                      <button
                        className="mini-button danger"
                        type="button"
                        onClick={() => onCancelEnrollment(item.id)}
                        title="Hủy đăng ký và xóa khỏi Google Group"
                      >
                        <Trash2 size={14} />
                        Hủy
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <EmptyTableRow colSpan={7} label="Chưa có học thử nào." />
            )}
          </tbody>
        </DataTable>
      </section>
    </>
  );
}

function CtvView({
  state,
  model,
  trialRecords,
  onAddCtv,
  onRateChange,
  onMarkReceived,
}: {
  state: AppState;
  model: ReturnType<typeof buildModelShape>;
  trialRecords: TrialRecord[];
  onAddCtv: (form: CtvFormState) => void;
  onRateChange: (ctvId: string, rate: number) => void;
  onMarkReceived: (ctvId: string) => void;
}) {
  const [showAddCtv, setShowAddCtv] = useState(false);

  // Gom CTV theo email domain thật (người đăng nhập đã thêm học thử) từ Sheet.
  const ctvByEmail = new Map<
    string,
    { email: string; name: string; count: number; courses: Set<string> }
  >();
  for (const record of trialRecords) {
    const key = record.ctvEmail.trim().toLowerCase();
    if (!key) continue;
    const entry = ctvByEmail.get(key) ?? {
      email: record.ctvEmail,
      name: record.ctvName,
      count: 0,
      courses: new Set<string>(),
    };
    entry.count += 1;
    if (record.trialCourse) entry.courses.add(record.trialCourse);
    if (!entry.name && record.ctvName) entry.name = record.ctvName;
    ctvByEmail.set(key, entry);
  }
  const ctvAccounts = Array.from(ctvByEmail.values()).sort((a, b) => b.count - a.count);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>CTV</h1>
          <p>Tỷ lệ hoa hồng hiện tại và công nợ theo từng cộng tác viên.</p>
        </div>
        <button className="button primary" type="button" onClick={() => setShowAddCtv(true)}>
          <UserPlus size={17} />
          <span>Thêm CTV</span>
        </button>
      </div>

      <RevenueRanking state={state} />

      <section className="panel">
        <PanelHeader
          title="CTV theo tài khoản domain"
          action={`${ctvAccounts.length} CTV đã thêm học thử`}
        />
        <DataTable>
          <thead>
            <tr>
              <th>Email (domain)</th>
              <th>Tên</th>
              <th className="numeric">Số học viên thử</th>
              <th>Khóa đã thêm</th>
            </tr>
          </thead>
          <tbody>
            {ctvAccounts.length ? (
              ctvAccounts.map((account) => (
                <tr key={account.email}>
                  <td>
                    <strong>{account.email}</strong>
                  </td>
                  <td>{account.name || "-"}</td>
                  <td className="numeric">{account.count}</td>
                  <td>{Array.from(account.courses).join(", ") || "-"}</td>
                </tr>
              ))
            ) : (
              <EmptyTableRow
                colSpan={4}
                label="Chưa có CTV nào thêm học thử (đồng bộ từ Google Sheet)."
              />
            )}
          </tbody>
        </DataTable>
      </section>

      <div className="ctv-grid">
        {model.ctvDebt.map((row) => (
          <section className="panel ctv-card" key={row.ctv.id}>
            <div className="ctv-card-head">
              <div>
                <h2>{row.ctv.name}</h2>
                <span>{row.ctv.email}</span>
              </div>
              <StatusBadge variant={row.debt > 0 ? "warning" : "success"}>
                {row.debt > 0 ? "Còn nợ" : "Đã đủ"}
              </StatusBadge>
            </div>
            <div className="ctv-stats">
              <InlineStat label="Đáng nhận" value={currency(row.expected)} />
              <InlineStat label="Đã thu" value={currency(row.received)} />
              <InlineStat label="Còn nợ" value={currency(row.debt)} strong />
            </div>
            <label className="field-label">
              Tỷ lệ hiện tại
              <input
                className="input"
                type="number"
                min="0"
                max="100"
                step="1"
                value={Math.round(row.ctv.commissionRate * 100)}
                onChange={(event) => onRateChange(row.ctv.id, Number(event.target.value) / 100)}
              />
            </label>
            <button className="button secondary full" type="button" onClick={() => onMarkReceived(row.ctv.id)}>
              <CheckCircle2 size={17} />
              <span>Đánh dấu đã nhận</span>
            </button>
          </section>
        ))}
      </div>
      <section className="panel">
        <PanelHeader title="Giao dịch theo CTV" action={`${state.enrollments.length} bản ghi`} />
        <DataTable>
          <thead>
            <tr>
              <th>CTV</th>
              <th>Gmail</th>
              <th>Môn</th>
              <th className="numeric">Snapshot</th>
              <th className="numeric">Anh nhận</th>
              <th>Tiền</th>
            </tr>
          </thead>
          <tbody>
            {paidEnrollments(state).length ? (
              paidEnrollments(state).map((item) => {
                const ctv = model.ctvMap.get(item.ctvId);
                const student = model.studentMap.get(item.studentId);
                return (
                  <tr key={item.id}>
                    <td>{ctv?.name}</td>
                    <td>{student?.gmail}</td>
                    <td>{item.courseType}</td>
                    <td className="numeric">{Math.round(item.commissionRateSnapshot * 100)}%</td>
                    <td className="numeric money-cell">{currency(item.ownerShare)}</td>
                    <td>
                      <PaymentBadge status={item.paymentStatus} />
                    </td>
                  </tr>
                );
              })
            ) : (
              <EmptyTableRow colSpan={6} label="Chưa có giao dịch theo CTV." />
            )}
          </tbody>
        </DataTable>
      </section>
      {showAddCtv ? (
        <AddCtvModal
          defaultRate={state.settings.defaultCommissionRate}
          nextIndex={state.ctvs.length + 1}
          onClose={() => setShowAddCtv(false)}
          onSubmit={(form) => {
            onAddCtv(form);
            setShowAddCtv(false);
          }}
        />
      ) : null}
    </>
  );
}

type RevenueRankingPeriod = "week" | "month";

type RevenueRankingRow = {
  ctv: Ctv;
  revenue: number;
  commission: number;
  received: number;
  orders: number;
};

function rankingDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rankingRange(period: RevenueRankingPeriod) {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start =
    period === "month"
      ? new Date(end.getFullYear(), end.getMonth(), 1)
      : new Date(end.getFullYear(), end.getMonth(), end.getDate() - ((end.getDay() + 6) % 7));

  return { start: rankingDate(start), end: rankingDate(end) };
}

function rangeDateLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(
    new Date(year, month - 1, day),
  );
}

function RevenueRanking({ state }: { state: AppState }) {
  const [period, setPeriod] = useState<RevenueRankingPeriod>("week");
  const range = rankingRange(period);
  const paid = paidEnrollments(state);
  const ranking = state.ctvs
    .map<RevenueRankingRow>((ctv) => {
      const rows = paid.filter(
        (item) => item.ctvId === ctv.id && item.date >= range.start && item.date <= range.end,
      );
      return {
        ctv,
        revenue: rows.reduce((sum, item) => sum + item.tuition, 0),
        commission: rows.reduce((sum, item) => sum + item.ownerShare, 0),
        received: rows
          .filter((item) => item.paymentStatus === "received")
          .reduce((sum, item) => sum + item.ownerShare, 0),
        orders: rows.length,
      };
    })
    .sort(
      (a, b) =>
        b.revenue - a.revenue ||
        b.commission - a.commission ||
        a.ctv.name.localeCompare(b.ctv.name),
    );
  const activeRanking = ranking.filter((row) => row.orders > 0);
  const leaderRevenue = activeRanking[0]?.revenue ?? 0;
  const totalRevenue = activeRanking.reduce((sum, row) => sum + row.revenue, 0);
  const totalCommission = activeRanking.reduce((sum, row) => sum + row.commission, 0);
  const periodLabel = period === "week" ? "tuần này" : "tháng này";
  const rowsToShow = activeRanking.length ? activeRanking : ranking;

  return (
    <section className="panel revenue-ranking-panel">
      <div className="ranking-heading">
        <div className="ranking-title-wrap">
          <div className="ranking-icon" aria-hidden="true">
            <Trophy size={19} />
          </div>
          <div>
            <div className="panel-header ranking-panel-header">
              <h2>Xếp hạng doanh thu CTV</h2>
              <span>{activeRanking.length} CTV có doanh số</span>
            </div>
            <p>
              Tiến độ theo doanh số học phí · {rangeDateLabel(range.start)} - {rangeDateLabel(range.end)}
            </p>
          </div>
        </div>
        <div className="ranking-period-control" role="group" aria-label="Khoảng thời gian xếp hạng">
          <CalendarDays size={15} aria-hidden="true" />
          <div className="segmented">
            {([
              ["week", "Tuần"],
              ["month", "Tháng"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={period === value ? "active" : ""}
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ranking-summary">
        <div>
          <span>Doanh số {periodLabel}</span>
          <strong>{currency(totalRevenue)}</strong>
        </div>
        <div>
          <span>Hoa hồng CTV</span>
          <strong>{currency(totalCommission)}</strong>
        </div>
        <div>
          <span>Người dẫn đầu</span>
          <strong>{activeRanking[0]?.ctv.name ?? "Chưa có dữ liệu"}</strong>
        </div>
      </div>

      {activeRanking.length ? (
        <>
          <div className="ranking-podium" aria-label={`Top 3 CTV ${periodLabel}`}>
            {activeRanking.slice(0, 3).map((row, index) => {
              const rank = index + 1;
              return (
                <article className={`ranking-podium-card rank-${rank}`} key={row.ctv.id}>
                  <div className="ranking-medal">{rank === 1 ? <Trophy size={17} /> : rank}</div>
                  <div className="ranking-avatar">
                    {row.ctv.name.trim().slice(0, 1).toUpperCase() || "C"}
                  </div>
                  <div className="ranking-person">
                    <strong>{row.ctv.name}</strong>
                    <span>{row.ctv.code}</span>
                  </div>
                  <strong className="ranking-podium-money">{currency(row.revenue)}</strong>
                  <span className="ranking-podium-meta">
                    {row.orders} đơn · {currency(row.commission)} hoa hồng
                  </span>
                </article>
              );
            })}
          </div>

          <div className="ranking-table-wrap">
            <table className="data-table ranking-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>CTV</th>
                  <th className="numeric">Doanh số</th>
                  <th className="numeric">Hoa hồng</th>
                  <th className="numeric">Đơn</th>
                  <th>Tiến độ</th>
                </tr>
              </thead>
              <tbody>
                {rowsToShow.map((row, index) => {
                  const progress = leaderRevenue ? Math.round((row.revenue / leaderRevenue) * 100) : 0;
                  const receivedRate = row.commission ? Math.round((row.received / row.commission) * 100) : 0;
                  return (
                    <tr key={row.ctv.id}>
                      <td>
                        <span className={index < 3 ? "ranking-number top" : "ranking-number"}>
                          {index + 1}
                        </span>
                      </td>
                      <td>
                        <div className="ranking-table-person">
                          <div className="ranking-avatar small">
                            {row.ctv.name.trim().slice(0, 1).toUpperCase() || "C"}
                          </div>
                          <div>
                            <strong>{row.ctv.name}</strong>
                            <span>{row.ctv.email || row.ctv.code}</span>
                          </div>
                        </div>
                      </td>
                      <td className="numeric money-cell">
                        <strong>{currency(row.revenue)}</strong>
                      </td>
                      <td className="numeric money-cell">
                        {currency(row.commission)}
                        <small className="ranking-received">{receivedRate}% đã thu</small>
                      </td>
                      <td className="numeric">{row.orders}</td>
                      <td>
                        <div className="ranking-progress-cell">
                          <div className="ranking-progress-track" aria-label={`${progress}% so với người dẫn đầu`}>
                            <span style={{ width: `${progress}%` }} />
                          </div>
                          <strong>{progress}%</strong>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState label={`Chưa có giao dịch trả phí trong ${periodLabel}.`} />
      )}
    </section>
  );
}

function StudentsView({
  state,
  onCancelEnrollment,
  onLockStudent,
}: {
  state: AppState;
  onCancelEnrollment?: (id: string) => void;
  onLockStudent?: (studentId: string) => Promise<ApiLockStudentResult | undefined>;
}) {
  const ctvMap = byId(state.ctvs);
  const groupMap = byId(state.groups);
  const [lockingStudentId, setLockingStudentId] = useState<string | null>(null);

  async function lockStudent(studentId: string) {
    if (!onLockStudent || lockingStudentId) return;
    setLockingStudentId(studentId);
    try {
      await onLockStudent(studentId);
    } catch {
      // Thông báo lỗi được hiển thị ở admin notice chung.
    } finally {
      setLockingStudentId(null);
    }
  }
  return (
    <>
      <PageTitle title="Học viên" subtitle="Hồ sơ theo Gmail, lịch sử học thử/trả phí và nhóm đang liên quan." />
      <section className="panel">
        <div className="student-list">
          {state.students.length ? (
            state.students.map((student) => {
              const rows = state.enrollments
                .filter((item) => item.studentId === student.id)
                .sort((a, b) => b.date.localeCompare(a.date));
              return (
                <article className="student-row" key={student.id}>
                  <div className="avatar">{student.name.slice(0, 1).toUpperCase()}</div>
                  <div className="student-main">
                    <strong>{student.gmail}</strong>
                    <span>{student.name}</span>
                  </div>
                  <div className="student-tags">
                    {rows.map((item) => {
                      const label =
                        item.type === "trial"
                          ? item.courseType || groupMap.get(item.groupId)?.name || "Học thử"
                          : groupMap.get(item.groupId)?.name || item.courseType;
                      return (
                        <span className="tag student-course-tag" key={item.id} title={label}>
                          <span>{label}</span>
                          {onCancelEnrollment ? (
                            <button
                              aria-label={`Hủy đăng ký ${label}`}
                              className="tag-action"
                              onClick={() => onCancelEnrollment(item.id)}
                              title="Hủy đăng ký và xóa khỏi Google Group"
                              type="button"
                            >
                              <Trash2 size={13} />
                            </button>
                          ) : null}
                        </span>
                      );
                    })}
                  </div>
                  <div className="student-side">
                    <span>{rows.length} đăng ký</span>
                    <span>{ctvMap.get(rows[0]?.ctvId)?.name ?? "Chưa có CTV"}</span>
                    {onLockStudent ? (
                      <button
                        className="mini-button danger student-lock-button"
                        disabled={Boolean(lockingStudentId)}
                        onClick={() => void lockStudent(student.id)}
                        title="Gỡ học viên khỏi tất cả Google Group mà họ đang là thành viên"
                        type="button"
                      >
                        <LockKeyhole size={14} />
                        {lockingStudentId === student.id ? "Đang khóa…" : "Khóa truy cập"}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <EmptyState label="Chưa có học viên." />
          )}
        </div>
      </section>
    </>
  );
}

function GroupsView({
  state,
  isAdmin,
  studentGroupsOnly,
  trialRecords,
  onAddGroup,
  onDeleteGroup,
  onSyncFromGoogle,
  onOpenGroup,
  onAddMember,
  onRemoveMember,
  onUpdateRole,
  focusGroupId = null,
  onFocusGroupHandled,
}: {
  state: AppState;
  isAdmin: boolean;
  studentGroupsOnly: boolean;
  trialRecords: TrialRecord[];
  onAddGroup: (form: GroupFormState) => void;
  onDeleteGroup: (groupId: string) => void;
  onSyncFromGoogle: () => void | Promise<void>;
  onOpenGroup: (group: CourseGroup) => void;
  onAddMember: (
    groupId: string,
    email: string,
    name: string,
    role: GroupRole,
    trialCourse?: string,
  ) => void | Promise<void>;
  onRemoveMember: (memberId: string) => void;
  onUpdateRole: (memberId: string, role: GroupRole) => void;
  /** Nhóm cần mở sẵn (bấm từ sidebar). Mở modal thành viên rồi báo cha đã xử lý. */
  focusGroupId?: string | null;
  onFocusGroupHandled?: () => void;
}) {
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupSearch, setGroupSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | CourseGroup["kind"]>("all");
  const [syncingGroups, setSyncingGroups] = useState(false);
  const activeGroup = activeGroupId ? state.groups.find((group) => group.id === activeGroupId) : null;

  // Mở nhóm được chọn từ sidebar: hiện modal thành viên + tải danh sách thật.
  useEffect(() => {
    if (!focusGroupId) return;
    const target = state.groups.find((group) => group.id === focusGroupId);
    if (target) {
      setActiveGroupId(target.id);
      void onOpenGroup(target);
    }
    onFocusGroupHandled?.();
    // Chỉ chạy khi focusGroupId đổi; các dep khác ổn định trong vòng đời component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusGroupId]);
  const scopedGroups = isAdmin
    ? state.groups.filter((group) => isStudentGroup(group) === studentGroupsOnly)
    : state.groups;
  const searchTerms = groupSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visibleGroups = scopedGroups.filter((group) => {
    if (kindFilter !== "all" && group.kind !== kindFilter) return false;
    if (!searchTerms.length) return true;
    const haystack = [
      group.name,
      group.groupEmail,
      group.subject,
      group.teacher,
      group.kind,
      groupKindLabel(group.kind),
      group.kind === "trial" ? "hoc thu học thử trial" : "",
      group.kind === "paid" ? "tra phi trả phí paid" : "",
      group.kind === "combo" ? "combo goi bộ" : "",
      String(group.priceHint),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchTerms.every((term) => haystack.includes(term));
  });
  const visibleGroupIds = new Set(visibleGroups.map((group) => group.id));
  const visibleJobs = state.jobs.filter((job) =>
    job.groupId ? visibleGroupIds.has(job.groupId) : !studentGroupsOnly,
  );
  const hasGroupFilter = Boolean(groupSearch.trim()) || kindFilter !== "all";
  const syncLabel = syncingGroups ? "Đang đồng bộ..." : isAdmin ? "Đồng bộ Google Group" : "Tải lại nhóm";
  const syncTitle = isAdmin
    ? "Nạp lại danh sách nhóm và số thành viên thật từ Google"
    : "Tải lại các nhóm học thử được cấp quyền";
  const emptyGroupLabel = hasGroupFilter
    ? "Không tìm thấy nhóm phù hợp. Thử tên khóa, email group, môn học hoặc giáo viên."
    : isAdmin
      ? studentGroupsOnly
        ? "Chưa có khóa sinh viên nào. Các group có email bắt đầu bằng sv- sẽ xuất hiện tại đây."
        : "Chưa có nhóm nào. Bấm 'Đồng bộ Google Group' để nạp nhóm thật."
      : "Bạn chưa được cấp quyền nhóm nào. Liên hệ quản trị viên để được thêm vào nhóm.";

  async function handleSyncGroups() {
    if (syncingGroups) return;
    setSyncingGroups(true);
    try {
      await onSyncFromGoogle();
    } finally {
      setSyncingGroups(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {studentGroupsOnly
              ? "Khóa sinh viên"
              : isAdmin
                ? "Nhóm / Khóa học"
                : "Nhóm của tôi"}
          </h1>
          <p>
            {studentGroupsOnly
              ? "Các nhóm sinh viên có email Google Group bắt đầu bằng tiền tố sv-."
              : isAdmin
              ? "Gán môn, giáo viên và Google Group cho từng khóa."
              : "Các nhóm bạn được cấp quyền. Bạn có thể thêm/xóa/đổi vai trò thành viên."}
          </p>
        </div>
      </div>
      <section className="group-command-bar" aria-label="Công cụ quản lý nhóm">
        <label className="group-search-box">
          <Search size={18} aria-hidden="true" />
          <input
            value={groupSearch}
            onChange={(event) => setGroupSearch(event.target.value)}
            placeholder="Tìm nhóm theo tên, email, môn học..."
            aria-label="Tìm nhóm"
          />
          {groupSearch ? (
            <button
              className="group-search-clear"
              type="button"
              aria-label="Xóa tìm kiếm nhóm"
              onClick={() => setGroupSearch("")}
            >
              <X size={16} />
            </button>
          ) : null}
        </label>
        <label className="group-kind-filter">
          <Filter size={16} aria-hidden="true" />
          <select
            value={kindFilter}
            aria-label="Lọc loại nhóm"
            onChange={(event) => setKindFilter(event.target.value as "all" | CourseGroup["kind"])}
          >
            <option value="all">Tất cả nhóm</option>
            <option value="trial">Học thử</option>
            <option value="paid">Trả phí</option>
            <option value="combo">Combo</option>
          </select>
        </label>
        <div className="group-command-actions">
          <button
            className="button secondary group-sync-button"
            type="button"
            title={syncTitle}
            disabled={syncingGroups}
            onClick={handleSyncGroups}
          >
            <RefreshCw size={17} />
            <span>{syncLabel}</span>
          </button>
          {isAdmin ? (
            <button className="button primary" type="button" onClick={() => setShowAddGroup(true)}>
              <Plus size={17} />
              <span>{studentGroupsOnly ? "Thêm khóa sinh viên" : "Thêm nhóm"}</span>
            </button>
          ) : null}
        </div>
        <p className="group-result-count">
          {visibleGroups.length}/{scopedGroups.length} nhóm
          {hasGroupFilter ? " phù hợp" : ""}
        </p>
      </section>
      <div className="group-grid">
        {visibleGroups.length ? (
          visibleGroups.map((group) => (
            <section className="panel group-card" key={group.id}>
              <div className="group-icon">
                <Link2 size={20} />
              </div>
              <div>
                <h2>{group.name}</h2>
                <p>{group.groupEmail}</p>
              </div>
              <div className="group-meta">
                <span>{group.subject}</span>
                <span>{group.teacher}</span>
                <span>{currency(group.priceHint)}</span>
              </div>
              <div className="group-footer">
                <StatusBadge variant={group.kind === "trial" ? "info" : "success"}>
                  {groupKindLabel(group.kind)}
                </StatusBadge>
                <span>
                  <Users size={14} aria-hidden="true" />{" "}
                  {group.directMembersCount ?? memberCount(state, group.id)} thành viên
                </span>
              </div>
              <div className="group-actions">
                <button
                  className="mini-button"
                  type="button"
                  onClick={() => {
                    setActiveGroupId(group.id);
                    onOpenGroup(group);
                  }}
                >
                  <UserPlus size={14} />
                  Quản lý thành viên
                </button>
                {isAdmin ? (
                  <button
                    className="mini-button ghost"
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Xóa nhóm "${group.name}"? Mọi thành viên đã lưu của nhóm cũng bị xóa.`)) {
                        onDeleteGroup(group.id);
                      }
                    }}
                  >
                    <X size={14} />
                    Xóa nhóm
                  </button>
                ) : null}
              </div>
            </section>
          ))
        ) : (
          <EmptyState label={emptyGroupLabel} />
        )}
      </div>
      {isAdmin ? (
        <section className="panel">
          <PanelHeader title="Tình trạng queue theo nhóm" action={`${visibleJobs.length} jobs`} />
          <div className="stack-list">
            {visibleJobs.length ? (
              visibleJobs.slice(0, 6).map((job) => (
                <div className="queue-row" key={job.id}>
                  <div>
                    <strong>{jobGroupLabel(state, job, "Admin SDK")}</strong>
                    <span>{job.studentGmail ?? "Tài khoản automation"}</span>
                  </div>
                  <JobBadge status={job.status} />
                </div>
              ))
            ) : (
              <EmptyState label="Chưa có job Google Group." />
            )}
          </div>
        </section>
      ) : null}

      {showAddGroup ? (
        <AddGroupModal
          studentGroup={studentGroupsOnly}
          onClose={() => setShowAddGroup(false)}
          onSubmit={(form) => {
            onAddGroup(form);
            setShowAddGroup(false);
          }}
        />
      ) : null}

      {activeGroup ? (
        <GroupMembersModal
          group={activeGroup}
          members={membersByGroup(state, activeGroup.id)}
          isAdmin={isAdmin}
          trialRecords={trialRecords.filter(
            (record) =>
              record.groupEmail.trim().toLowerCase() ===
              activeGroup.groupEmail.trim().toLowerCase(),
          )}
          onClose={() => setActiveGroupId(null)}
          onAddMember={onAddMember}
          onRemoveMember={onRemoveMember}
          onUpdateRole={onUpdateRole}
        />
      ) : null}
    </>
  );
}

function GroupMembersModal({
  group,
  members,
  isAdmin,
  trialRecords,
  onClose,
  onAddMember,
  onRemoveMember,
  onUpdateRole,
}: {
  group: CourseGroup;
  members: AppState["groupMembers"];
  isAdmin: boolean;
  trialRecords: TrialRecord[];
  onClose: () => void;
  onAddMember: (
    groupId: string,
    email: string,
    name: string,
    role: GroupRole,
    trialCourse?: string,
  ) => void | Promise<void>;
  onRemoveMember: (memberId: string) => void;
  onUpdateRole: (memberId: string, role: GroupRole) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<GroupRole>("member");
  const [trialCourse, setTrialCourse] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  // Nhóm học thử (hoặc CTV — chỉ thao tác nhóm học thử) → cần ô "Khóa học thử".
  const showTrial = group.kind === "trial" || !isAdmin;
  const courseByEmail = new Map(
    trialRecords.map((record) => [record.studentEmail.trim().toLowerCase(), record.trialCourse]),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || adding) return;
    setError("");
    setAdding(true);
    try {
      await onAddMember(group.id, email, name, role, showTrial ? trialCourse : undefined);
      setEmail("");
      setName("");
      setRole("member");
      setTrialCourse("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <ModalShell title={`Thành viên · ${group.name}`} onClose={onClose}>
      <div className="member-modal">
        <p className="member-modal-sub">
          {group.groupEmail} · {members.length} thành viên
        </p>
        <form className="member-add-row" onSubmit={submit}>
          <input
            className="input"
            type="email"
            placeholder="Email thành viên"
            value={email}
            required
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            className="input"
            type="text"
            placeholder="Tên (tùy chọn)"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {showTrial ? (
            <input
              className="input"
              type="text"
              placeholder="Khóa học thử"
              value={trialCourse}
              onChange={(event) => setTrialCourse(event.target.value)}
            />
          ) : null}
          {isAdmin ? (
            <select
              className="select compact"
              value={role}
              onChange={(event) => setRole(event.target.value as GroupRole)}
              aria-label="Role thành viên mới"
            >
              <option value="member">Thành viên</option>
              <option value="manager">Quản lý</option>
              <option value="owner">Chủ sở hữu</option>
            </select>
          ) : null}
          <button className="button primary" type="submit" disabled={adding}>
            <UserPlus size={16} />
            <span>{adding ? "Đang thêm…" : "Thêm"}</span>
          </button>
        </form>
        {error ? <p className="status-note danger">{error}</p> : null}
        <div className="table-wrap">
          <table className="data-table member-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Tên</th>
                {showTrial ? <th>Khóa học thử</th> : null}
                <th>Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.length ? (
                members.map((member) => (
                  <tr key={member.id}>
                    <td data-label="Email">
                      <strong>{member.email}</strong>
                    </td>
                    <td data-label="Tên">{member.name ?? "-"}</td>
                    {showTrial ? (
                      <td data-label="Khóa học thử">
                        {courseByEmail.get(member.email.trim().toLowerCase()) || "-"}
                      </td>
                    ) : null}
                    <td data-label="Role">
                      {isAdmin ? (
                        <select
                          className="select compact"
                          value={member.role}
                          onChange={(event) =>
                            onUpdateRole(member.id, event.target.value as GroupRole)
                          }
                          aria-label={`Đổi role của ${member.email}`}
                        >
                          <option value="member">Thành viên</option>
                          <option value="manager">Quản lý</option>
                          <option value="owner">Chủ sở hữu</option>
                        </select>
                      ) : (
                        <span className="tag">
                          {member.role === "owner"
                            ? "Chủ sở hữu"
                            : member.role === "manager"
                              ? "Quản lý"
                              : "Thành viên"}
                        </span>
                      )}
                    </td>
                    <td className="row-actions">
                      {isAdmin ? (
                        <button
                          className="mini-button ghost"
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Xóa ${member.email} khỏi nhóm?`)) {
                              onRemoveMember(member.id);
                            }
                          }}
                        >
                          <X size={14} />
                          Xóa
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyTableRow
                  colSpan={showTrial ? 5 : 4}
                  label="Chưa có thành viên. Thêm email phía trên."
                />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ModalShell>
  );
}

function AddGroupModal({
  studentGroup,
  onClose,
  onSubmit,
}: {
  studentGroup: boolean;
  onClose: () => void;
  onSubmit: (form: GroupFormState) => void;
}) {
  const [form, setForm] = useState<GroupFormState>({
    name: "",
    groupEmail: studentGroup ? "sv-" : "",
    subject: "",
    teacher: "",
    kind: "paid",
    priceHint: "0",
  });
  const [error, setError] = useState("");

  return (
    <ModalShell title="Thêm Google Group" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (studentGroup && !isStudentGroup({ groupEmail: form.groupEmail })) {
            setError("Email group khóa sinh viên phải bắt đầu bằng tiền tố sv-.");
            return;
          }
          onSubmit(form);
        }}
      >
        <TextField label="Tên nhóm" value={form.name} required onChange={(name) => setForm({ ...form, name })} />
        <TextField
          label="Google Group email"
          value={form.groupEmail}
          type="email"
          required
          onChange={(groupEmail) => {
            setError("");
            setForm({ ...form, groupEmail });
          }}
        />
        {error ? <p className="status-note danger">{error}</p> : null}
        <TextField label="Môn" value={form.subject} onChange={(subject) => setForm({ ...form, subject })} />
        <TextField label="Giáo viên" value={form.teacher} onChange={(teacher) => setForm({ ...form, teacher })} />
        <SelectField
          label="Loại"
          value={form.kind}
          onChange={(kind) => setForm({ ...form, kind: kind as CourseGroup["kind"] })}
          options={[
            { value: "trial", label: "Học thử" },
            { value: "paid", label: "Trả phí" },
            { value: "combo", label: "Combo" },
          ]}
        />
        <TextField
          label="Giá gợi ý"
          value={form.priceHint}
          type="number"
          onChange={(priceHint) => setForm({ ...form, priceHint })}
        />
        <div className="modal-actions">
          <button className="button ghost" type="button" onClick={onClose}>
            <X size={17} />
            <span>Hủy</span>
          </button>
          <button className="button primary" type="submit">
            <Save size={17} />
            <span>Lưu nhóm</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function AddCtvModal({
  defaultRate,
  nextIndex,
  onClose,
  onSubmit,
}: {
  defaultRate: number;
  nextIndex: number;
  onClose: () => void;
  onSubmit: (form: CtvFormState) => void;
}) {
  const [form, setForm] = useState<CtvFormState>({
    code: `CTV${String(nextIndex).padStart(3, "0")}`,
    name: "",
    email: "",
    commissionRate: String(Math.round(defaultRate * 100)),
  });

  return (
    <ModalShell title="Thêm CTV" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(form);
        }}
      >
        <TextField label="Mã CTV" value={form.code} required onChange={(code) => setForm({ ...form, code })} />
        <TextField label="Tên CTV" value={form.name} required onChange={(name) => setForm({ ...form, name })} />
        <TextField
          label="Email"
          value={form.email}
          type="email"
          required
          onChange={(email) => setForm({ ...form, email })}
        />
        <TextField
          label="Hoa hồng (%)"
          value={form.commissionRate}
          type="number"
          required
          onChange={(commissionRate) => setForm({ ...form, commissionRate })}
        />
        <div className="modal-actions">
          <button className="button ghost" type="button" onClick={onClose}>
            <X size={17} />
            <span>Hủy</span>
          </button>
          <button className="button primary" type="submit">
            <Save size={17} />
            <span>Lưu CTV</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ExpenseModal({
  expense,
  onClose,
  onSubmit,
}: {
  expense?: Expense;
  onClose: () => void;
  onSubmit: (input: ExpenseInput) => void;
}) {
  const [date, setDate] = useState(expense?.date ?? todayISO());
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? "material");
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [note, setNote] = useState(expense?.note ?? "");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedAmount = Math.round(Number(amount));
    if (!date) {
      setError("Vui lòng chọn ngày chi.");
      return;
    }
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      setError("Số tiền phải lớn hơn 0.");
      return;
    }
    onSubmit({ date, category, amount: normalizedAmount, note });
  }

  return (
    <ModalShell title={expense ? "Sửa khoản chi" : "Thêm khoản chi"} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <TextField label="Ngày" type="date" value={date} onChange={setDate} required />
        <SelectField
          label="Danh mục"
          value={category}
          options={expenseCategories.map((value) => ({ value, label: expenseCategoryLabel(value) }))}
          onChange={(value) => setCategory(value as ExpenseCategory)}
        />
        <TextField label="Số tiền (VND)" type="number" value={amount} onChange={setAmount} required />
        <TextField label="Ghi chú" value={note} onChange={setNote} />
        {error ? <p className="status-note danger expense-form-error">{error}</p> : null}
        <div className="modal-actions">
          <button className="button ghost" type="button" onClick={onClose}>Hủy</button>
          <button className="button primary" type="submit">
            <Save size={17} />
            <span>{expense ? "Lưu thay đổi" : "Lưu khoản chi"}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function JobsView({
  state,
  activityJobs,
  onRefresh,
  onRetryJob,
  onCompleteJob,
}: {
  state: AppState;
  activityJobs: GroupJob[];
  onRefresh: () => void;
  onRetryJob: (id: string) => void;
  onCompleteJob: (id: string) => void;
}) {
  const jobs = useMemo(() => {
    const merged = new Map<string, GroupJob>();
    [...activityJobs, ...state.jobs].forEach((job) => merged.set(job.id, job));
    return Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [activityJobs, state.jobs]);
  const ctvJobCount = jobs.filter((job) => job.actorRole === "ctv").length;

  function actorLabel(job: GroupJob) {
    const knownCtv = job.actorEmail
      ? state.ctvs.find(
          (ctv) => ctv.email.trim().toLowerCase() === job.actorEmail?.trim().toLowerCase(),
        )
      : undefined;
    return job.actorName?.trim() || knownCtv?.name || (job.actorRole === "ctv" ? "CTV" : "Admin / hệ thống");
  }

  function jobTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Nhật ký công việc</h1>
          <p>Theo dõi thao tác Google Group của admin và CTV, gồm người làm, đối tượng và kết quả.</p>
        </div>
        <button className="button secondary" type="button" onClick={onRefresh}>
          <RefreshCw size={17} />
          <span>Làm mới</span>
        </button>
      </div>
      <section className="panel">
        <PanelHeader
          title="Hoạt động gần nhất"
          action={`${ctvJobCount} thao tác từ CTV · ${jobs.length} tổng cộng`}
        />
        {jobs.length ? (
          <DataTable className="jobs-table">
            <thead>
              <tr>
                <th>Người thực hiện</th>
                <th>Công việc</th>
                <th>Học viên</th>
                <th>Nhóm</th>
                <th>Kết quả</th>
                <th>Thời gian</th>
                <th>Chi tiết</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td data-label="Người thực hiện">
                    <strong>{actorLabel(job)}</strong>
                    <span className="table-subtext">{job.actorEmail || (job.actorRole === "ctv" ? "CTV" : "Admin")}</span>
                  </td>
                  <td data-label="Công việc">{jobLabel(job)}</td>
                  <td data-label="Học viên">{job.studentGmail ?? "-"}</td>
                  <td data-label="Nhóm">{jobGroupLabel(state, job)}</td>
                  <td data-label="Kết quả">
                    <JobBadge status={job.status} />
                  </td>
                  <td data-label="Thời gian">{jobTime(job.finishedAt || job.createdAt)}</td>
                  <td data-label="Chi tiết">{job.error ?? job.detail ?? "-"}</td>
                  <td className="row-actions">
                    {job.origin !== "ctv_activity" &&
                    (job.status === "failed" || job.status === "needs_session") ? (
                      <button className="mini-button" type="button" onClick={() => onRetryJob(job.id)}>
                        Retry
                      </button>
                    ) : null}
                    {job.origin !== "ctv_activity" && job.status !== "done" ? (
                      <button className="mini-button ghost" type="button" onClick={() => onCompleteJob(job.id)}>
                        Done
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState label="Chưa có job automation." />
        )}
      </section>
    </>
  );
}

function adminStatusLabel(status: AdminSdkState) {
  if (status.state === "ready") return "ready";
  if (status.state === "checking") return "checking";
  return "error";
}

function AdminStatusInline({ status }: { status: AdminSdkState }) {
  if (status.state === "ready") return <StatusBadge variant="success">Sẵn sàng</StatusBadge>;
  if (status.state === "checking") return <StatusBadge variant="info">Đang kiểm tra</StatusBadge>;
  return <StatusBadge variant="danger">Cần cấu hình</StatusBadge>;
}

function SettingsView({
  state,
  adminStatus,
  activityJobs,
  onReset,
  onRefreshAdminStatus,
  onRefreshJobs,
  onRetryJob,
  onCompleteJob,
  adminNotice,
}: {
  state: AppState;
  adminStatus: AdminSdkState;
  activityJobs: GroupJob[];
  onReset: () => void;
  onRefreshAdminStatus: () => void;
  onRefreshJobs: () => void;
  onRetryJob: (id: string) => void;
  onCompleteJob: (id: string) => void;
  adminNotice: string;
}) {
  const details = adminStatus.state === "ready" ? adminStatus.details : null;

  return (
    <>
      <PageTitle title="Cài đặt" subtitle="Thông số vận hành và cấu hình Admin SDK." />
      <div className="settings-grid">
        <section className="panel settings-panel">
          <PanelHeader title="Admin SDK" action={adminStatusLabel(adminStatus)} />
          <div className="settings-row">
            <span>Trạng thái</span>
            <AdminStatusInline status={adminStatus} />
          </div>
          <div className="settings-row">
            <span>Domain</span>
            <strong>{details?.domain ?? "-"}</strong>
          </div>
          <div className="settings-row">
            <span>Impersonate</span>
            <strong>{details?.impersonateEmail ?? "-"}</strong>
          </div>
          <div className="settings-row">
            <span>Service account</span>
            <strong>{details?.serviceAccountEmail ?? "-"}</strong>
          </div>
          <div className="settings-row">
            <span>Credential</span>
            <strong>{details?.credentialSource ?? "-"}</strong>
          </div>
          {adminStatus.state === "error" ? (
            <div className="admin-callout danger">
              <AlertTriangle size={17} />
              <span>{adminStatus.message}</span>
            </div>
          ) : null}
          <button className="button secondary full" type="button" onClick={onRefreshAdminStatus}>
            <RefreshCw size={17} />
            <span>Kiểm tra Admin SDK</span>
          </button>
          {adminNotice ? <p className="status-note success">{adminNotice}</p> : null}
        </section>

        <section className="panel settings-panel">
          <PanelHeader title="Thông số mặc định" action="Phase 1-2" />
          <div className="settings-row">
            <span>Hoa hồng mặc định</span>
            <strong>{Math.round(state.settings.defaultCommissionRate * 100)}%</strong>
          </div>
          <div className="settings-row">
            <span>Delay worker</span>
            <strong>
              {state.settings.minDelay}-{state.settings.maxDelay}s
            </strong>
          </div>
          <div className="settings-row">
            <span>Allowlist</span>
            <strong>{state.settings.allowlistEmails.join(", ")}</strong>
          </div>
          <button className="button danger full" type="button" onClick={onReset}>
            <RefreshCw size={17} />
            <span>Xóa sạch dữ liệu</span>
          </button>
        </section>
      </div>

      <JobsView
        state={state}
        activityJobs={activityJobs}
        onRefresh={onRefreshJobs}
        onRetryJob={onRetryJob}
        onCompleteJob={onCompleteJob}
      />
    </>
  );
}

function TransactionRow({
  enrollment,
  state,
  compact = false,
  onTogglePayment,
  onEnqueueJob,
  onChangeCtv,
  onEditTransaction,
  onCancelEnrollment,
  domainMembers = [],
}: {
  enrollment: Enrollment;
  state: AppState;
  compact?: boolean;
  onTogglePayment: (id: string) => void;
  onEnqueueJob?: (enrollment: Enrollment) => void;
  onChangeCtv?: (enrollmentId: string, ctvEmail: string) => void;
  onEditTransaction?: (id: string) => void;
  onCancelEnrollment?: (id: string) => void;
  domainMembers?: DomainMember[];
}) {
  const student = state.students.find((item) => item.id === enrollment.studentId);
  const ctv = state.ctvs.find((item) => item.id === enrollment.ctvId);
  const group = resolveEnrollmentGroup(state, enrollment);
  // Tùy chọn CTV: ưu tiên thành viên domain thật, kèm CTV cục bộ đang gán (nếu chưa có trong list).
  const ctvOptions = (
    domainMembers.length
      ? domainMembers.map((m) => ({ value: m.email, label: m.name ? `${m.name} · ${m.email}` : m.email }))
      : state.ctvs.map((c) => ({ value: c.email, label: ctvDisplay(c) }))
  ).slice();
  if (ctv && !ctvOptions.some((o) => o.value.toLowerCase() === ctv.email.trim().toLowerCase())) {
    ctvOptions.unshift({ value: ctv.email, label: ctvDisplay(ctv) });
  }

  if (compact) {
    return (
      <tr>
        <td>
          <strong>{student?.gmail}</strong>
          <span className="table-subtext">{student?.name}</span>
        </td>
        <td>{ctv?.name}</td>
        <td>{enrollment.courseType}</td>
        <td className="numeric money-cell">{currency(enrollment.ownerShare)}</td>
        <td>
          <PaymentBadge status={enrollment.paymentStatus} />
        </td>
        <td className="row-actions">
          <button className="mini-button" type="button" onClick={() => onTogglePayment(enrollment.id)}>
            {enrollment.paymentStatus === "received" ? "Hoàn tác" : "Đã nhận"}
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{shortDate(enrollment.date)}</td>
      <td>
        <strong>{student?.gmail}</strong>
        <span className="table-subtext">{student?.name}</span>
      </td>
      <td>
        {onChangeCtv ? (
          <select
            className="inline-select"
            value={ctv?.email ?? ""}
            onChange={(e) => onChangeCtv(enrollment.id, e.target.value)}
          >
            {ctvOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          ctv?.name
        )}
      </td>
      <td>
        {group?.name ?? enrollment.courseType}
        {enrollment.removedAt ? (
          <span className="table-subtext">Đã rời khóa · {shortDate(enrollment.removedAt)}</span>
        ) : null}
      </td>
      <td className="numeric money-cell">{currency(enrollment.tuition)}</td>
      <td className="numeric money-cell debt">{currency(enrollment.ownerShare)}</td>
      <td>
        <button className="status-button" type="button" onClick={() => onTogglePayment(enrollment.id)}>
          <PaymentBadge status={enrollment.paymentStatus} />
        </button>
      </td>
      <td>
        <StatusBadge variant="info">{group?.groupEmail ?? "Chưa gán"}</StatusBadge>
      </td>
      <td className="row-actions">
        {onEditTransaction ? (
          <button className="mini-button" type="button" onClick={() => onEditTransaction(enrollment.id)}>
            <Pencil size={14} />
            Sửa
          </button>
        ) : null}
        {onEnqueueJob ? (
          <button className="mini-button" type="button" onClick={() => onEnqueueJob(enrollment)}>
            <Send size={14} />
            Queue
          </button>
        ) : null}
        {onCancelEnrollment && !enrollment.removedAt ? (
          <button
            className="mini-button danger"
            type="button"
            onClick={() => onCancelEnrollment(enrollment.id)}
            title="Xóa học viên khỏi Google Group và gỡ luôn doanh thu đã thu của đăng ký này"
          >
            <Trash2 size={14} />
            Xóa khỏi khóa
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function EditTransactionModal({
  enrollment,
  state,
  domainMembers,
  onClose,
  onSubmit,
}: {
  enrollment: Enrollment;
  state: AppState;
  domainMembers: DomainMember[];
  onClose: () => void;
  onSubmit: (form: EditPaidFormState) => void;
}) {
  const student = state.students.find((item) => item.id === enrollment.studentId);
  const ctv = state.ctvs.find((item) => item.id === enrollment.ctvId);
  const paidGroups = state.groups.filter((group) => group.kind !== "trial");
  const groupsForEdit = paidGroups.length ? paidGroups : state.groups;
  const currentGroup = resolveEnrollmentGroup(state, enrollment);
  const domainOptions = domainMembers.map((member) => ({
    value: member.email,
    label: member.name ? `${member.name} · ${member.email}` : member.email,
  }));
  const localOptions = state.ctvs
    .filter((item) => item.email.trim())
    .map((item) => ({ value: item.email, label: ctvDisplay(item) }));
  const ctvOptions = [
    { value: "", label: "Không chọn email" },
    ...(domainOptions.length ? domainOptions : localOptions),
  ];
  if (ctv?.email && !ctvOptions.some((option) => option.value.toLowerCase() === ctv.email.toLowerCase())) {
    ctvOptions.splice(1, 0, { value: ctv.email, label: ctvDisplay(ctv) });
  }

  const [form, setForm] = useState<EditPaidFormState>({
    id: enrollment.id,
    gmail: student?.gmail ?? "",
    studentName: student?.name ?? "",
    ctvEmail: ctv?.email ?? "",
    ctvName: ctv?.name ?? "",
    // Dùng nhóm đã phân giải để dropdown chọn đúng nhóm và lưu lại groupId chuẩn.
    groupId: currentGroup?.id ?? enrollment.groupId,
    courseType: enrollment.courseType || currentGroup?.name || "",
    tuition: String(enrollment.tuition),
    commissionRate: String(Math.round(enrollment.commissionRateSnapshot * 10000) / 100),
    date: enrollment.date || todayISO(),
    paymentStatus: enrollment.paymentStatus,
    paymentReceivedDate: enrollment.paymentReceivedDate ?? todayISO(),
    note: enrollment.note ?? "",
  });

  const tuition = Math.max(0, Number(form.tuition) || 0);
  const commissionRate = Math.min(1, Math.max(0, (Number(form.commissionRate) || 0) / 100));
  const estimatedShare = ownerShare(tuition, commissionRate);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(form);
  }

  return (
    <ModalShell title="Sửa giao dịch" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <TextField
          label="Gmail học viên"
          value={form.gmail}
          required
          onChange={(gmail) => setForm({ ...form, gmail })}
        />
        <TextField
          label="Tên học viên"
          value={form.studentName}
          onChange={(studentName) => setForm({ ...form, studentName })}
        />
        <SelectField
          label="Email CTV"
          value={form.ctvEmail}
          options={ctvOptions}
          onChange={(ctvEmail) => {
            const matchedDomain = domainMembers.find(
              (member) => member.email.trim().toLowerCase() === ctvEmail.trim().toLowerCase(),
            );
            const matchedCtv = state.ctvs.find(
              (item) => item.email.trim().toLowerCase() === ctvEmail.trim().toLowerCase(),
            );
            setForm({
              ...form,
              ctvEmail,
              ctvName: matchedDomain?.name ?? matchedCtv?.name ?? form.ctvName,
            });
          }}
        />
        <TextField
          label="Tên CTV"
          value={form.ctvName}
          required={!form.ctvEmail}
          onChange={(ctvName) => setForm({ ...form, ctvName })}
        />
        <GroupSearchField
          label="Nhóm / khóa"
          value={form.groupId}
          groups={groupsForEdit}
          onChange={(groupId) => {
            const group = state.groups.find((item) => item.id === groupId);
            setForm({
              ...form,
              groupId,
              courseType: group?.name ?? form.courseType,
              tuition: group?.priceHint ? String(group.priceHint) : form.tuition,
            });
          }}
        />
        <TextField
          label="Môn/Combo"
          value={form.courseType}
          required
          onChange={(courseType) => setForm({ ...form, courseType })}
        />
        <TextField
          label="Học phí"
          value={form.tuition}
          type="number"
          required
          onChange={(tuition) => setForm({ ...form, tuition })}
        />
        <TextField
          label="% hoa hồng snapshot"
          value={form.commissionRate}
          type="number"
          required
          onChange={(commissionRate) => setForm({ ...form, commissionRate })}
        />
        <TextField
          label="Ngày giao dịch"
          value={form.date}
          type="date"
          required
          onChange={(date) => setForm({ ...form, date })}
        />
        <SelectField
          label="Trạng thái tiền"
          value={form.paymentStatus}
          options={[
            { value: "pending", label: "Chưa trả" },
            { value: "received", label: "Đã trả" },
          ]}
          onChange={(paymentStatus) =>
            setForm({
              ...form,
              paymentStatus: paymentStatus as PaymentStatus,
              paymentReceivedDate:
                paymentStatus === "received"
                  ? form.paymentReceivedDate || todayISO()
                  : form.paymentReceivedDate,
            })
          }
        />
        {form.paymentStatus === "received" ? (
          <TextField
            label="Ngày nhận tiền"
            value={form.paymentReceivedDate}
            type="date"
            onChange={(paymentReceivedDate) => setForm({ ...form, paymentReceivedDate })}
          />
        ) : null}
        <TextField label="Ghi chú" value={form.note} onChange={(note) => setForm({ ...form, note })} />
        <div className="form-summary">
          <span>Học phí</span>
          <strong>{currency(tuition)}</strong>
          <span>Anh nhận sau hoa hồng</span>
          <strong>{currency(estimatedShare)}</strong>
        </div>
        <div className="modal-actions">
          <button className="button ghost" type="button" onClick={onClose}>
            <X size={17} />
            <span>Hủy</span>
          </button>
          <button className="button primary" type="submit">
            <Save size={17} />
            <span>Lưu thay đổi</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// Modal gộp: 1 nút "Thêm" → chọn loại Trả phí / Học thử trong cùng form.
function EnrollmentModal({
  state,
  initialType,
  domainMembers,
  onClose,
  onSubmitPaid,
  onSubmitTrial,
}: {
  state: AppState;
  initialType: "paid" | "trial";
  domainMembers: DomainMember[];
  onClose: () => void;
  onSubmitPaid: (form: PaidFormState) => void;
  onSubmitTrial: (form: TrialFormState) => void;
}) {
  const [type, setType] = useState<"paid" | "trial">(initialType);

  const paidGroups = state.groups.filter((group) => group.kind !== "trial");
  // Học thử: CHỈ hiện nhóm học thử (không kèm combo/trả phí).
  const trialGroups = state.groups.filter((group) => group.kind === "trial");
  const initialGroups = initialType === "paid" ? paidGroups : trialGroups;
  const [courseTrack, setCourseTrack] = useState<CourseTrack>(() =>
    initialGroups.length === 0 || initialGroups.some((group) => !isStudentGroup(group))
      ? "thpt"
      : "student",
  );
  const matchesCourseTrack = (group: CourseGroup, track: CourseTrack = courseTrack) =>
    track === "student" ? isStudentGroup(group) : !isStudentGroup(group);
  const groupsForType = (type === "paid" ? paidGroups : trialGroups).filter((group) =>
    matchesCourseTrack(group),
  );
  const firstPaid = paidGroups.find((group) => matchesCourseTrack(group));
  const firstTrial = trialGroups.find((group) => matchesCourseTrack(group));
  const firstGroup = type === "paid" ? firstPaid : firstTrial;

  // CTV chọn từ thành viên nội bộ trong domain; fallback về CTV cục bộ nếu chưa nạp được.
  const ctvOptions =
    domainMembers.length > 0
      ? domainMembers.map((member) => ({
          value: member.email,
          label: member.name ? `${member.name} · ${member.email}` : member.email,
        }))
      : state.ctvs.map((ctv) => ({ value: ctv.email, label: ctvDisplay(ctv) }));

  const [form, setForm] = useState({
    gmail: "",
    studentName: "",
    ctvMode: "email" as "email" | "name",
    ctvEmail: ctvOptions[0]?.value ?? "",
    ctvName: "",
    groupId: firstGroup?.id ?? "",
    courseType: type === "paid" ? firstGroup?.name ?? "" : "Học thử",
    tuition: String(firstPaid?.priceHint ?? 0),
    date: todayISO(),
    trialEndDate: addDaysISO(7),
    note: "",
  });

  // Đổi loại → đặt lại nhóm + môn/combo + học phí mặc định cho loại đó.
  function switchType(next: "paid" | "trial") {
    if (next === type) return;
    const defaultGroup = next === "paid" ? firstPaid : firstTrial;
    setType(next);
    setForm((current) => ({
      ...current,
      groupId: defaultGroup?.id ?? "",
      courseType: next === "paid" ? defaultGroup?.name ?? "" : "Học thử",
      tuition: String(defaultGroup?.priceHint ?? current.tuition),
    }));
  }

  function switchCourseTrack(next: CourseTrack) {
    if (next === courseTrack) return;
    const sourceGroups = type === "paid" ? paidGroups : trialGroups;
    const defaultGroup = sourceGroups.find((group) => matchesCourseTrack(group, next));
    setCourseTrack(next);
    setForm((current) => ({
      ...current,
      groupId: defaultGroup?.id ?? "",
      courseType: type === "paid" ? defaultGroup?.name ?? "" : "Học thử",
      tuition: type === "paid" ? String(defaultGroup?.priceHint ?? 0) : current.tuition,
    }));
  }

  const selectedDomainMember = domainMembers.find(
    (member) => member.email.trim().toLowerCase() === form.ctvEmail.trim().toLowerCase(),
  );
  const selectedCtv = state.ctvs.find(
    (ctv) => ctv.email.trim().toLowerCase() === form.ctvEmail.trim().toLowerCase(),
  );
  const manualCtv = state.ctvs.find(
    (ctv) => ctv.name.trim().toLowerCase() === form.ctvName.trim().toLowerCase() && !ctv.email.trim(),
  );
  const activeCtv = form.ctvMode === "name" ? manualCtv : selectedCtv;
  const selectedCtvName = selectedDomainMember?.name ?? selectedCtv?.name ?? "";
  const estimatedShare = ownerShare(
    Number(form.tuition) || 0,
    activeCtv?.commissionRate ?? state.settings.defaultCommissionRate,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (type === "paid") {
      onSubmitPaid({
        gmail: form.gmail,
        studentName: form.studentName,
        ctvEmail: form.ctvMode === "email" ? form.ctvEmail : "",
        ctvName: form.ctvMode === "name" ? form.ctvName : selectedCtvName,
        groupId: form.groupId,
        courseType: form.courseType,
        tuition: form.tuition,
        date: form.date,
        note: form.note,
      });
    } else {
      onSubmitTrial({
        gmail: form.gmail,
        studentName: form.studentName,
        ctvEmail: form.ctvMode === "email" ? form.ctvEmail : "",
        ctvName: form.ctvMode === "name" ? form.ctvName : selectedCtvName,
        groupId: form.groupId,
        courseType: form.courseType,
        date: form.date,
        trialEndDate: form.trialEndDate,
        note: form.note,
      });
    }
  }
  const modalTitle = type === "trial" ? "Thêm học thử" : "Thêm giao dịch";

  return (
    <ModalShell title={modalTitle} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <div className="enrollment-course-tabs" role="tablist" aria-label="Chọn khóa học">
          <button
            className={courseTrack === "thpt" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={courseTrack === "thpt"}
            onClick={() => switchCourseTrack("thpt")}
          >
            Khóa THPT
          </button>
          <button
            className={courseTrack === "student" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={courseTrack === "student"}
            onClick={() => switchCourseTrack("student")}
          >
            Khóa sinh viên
          </button>
        </div>
        <div className="form-type-toggle">
          <Segmented
            value={type}
            options={[
              { value: "paid", label: "Trả phí" },
              { value: "trial", label: "Học thử" },
            ]}
            onChange={(value) => switchType(value as "paid" | "trial")}
          />
        </div>
        <TextField label="Gmail học viên" value={form.gmail} required onChange={(gmail) => setForm({ ...form, gmail })} />
        <TextField label="Tên học viên" value={form.studentName} onChange={(studentName) => setForm({ ...form, studentName })} />
        <div className="form-type-toggle">
          <Segmented
            value={form.ctvMode}
            options={[
              { value: "email", label: "Email nội bộ" },
              { value: "name", label: "Tên CTV" },
            ]}
            onChange={(value) =>
              setForm({
                ...form,
                ctvMode: value as "email" | "name",
                ctvEmail: value === "email" ? form.ctvEmail || ctvOptions[0]?.value || "" : "",
                ctvName: value === "name" ? form.ctvName : "",
              })
            }
          />
        </div>
        {form.ctvMode === "email" ? (
          <SelectField
            label="CTV (tài khoản domain)"
            value={form.ctvEmail}
            onChange={(ctvEmail) => setForm({ ...form, ctvEmail })}
            options={ctvOptions}
          />
        ) : (
          <TextField
            label="Tên CTV"
            value={form.ctvName}
            required
            onChange={(ctvName) => setForm({ ...form, ctvName })}
          />
        )}
        <GroupSearchField
          label={type === "paid" ? "Nhóm / khóa" : "Google Group"}
          value={form.groupId}
          groups={groupsForType}
          onChange={(groupId) => {
            const group = state.groups.find((item) => item.id === groupId);
            setForm((current) => ({
              ...current,
              groupId,
              courseType: type === "paid" ? group?.name ?? current.courseType : current.courseType,
              tuition: type === "paid" ? String(group?.priceHint ?? current.tuition) : current.tuition,
            }));
          }}
        />
        <TextField
          label={type === "paid" ? "Môn/Combo" : "Môn/Combo thử"}
          value={form.courseType}
          required
          onChange={(courseType) => setForm({ ...form, courseType })}
        />
        {type === "paid" ? (
          <TextField label="Học phí" value={form.tuition} type="number" required onChange={(tuition) => setForm({ ...form, tuition })} />
        ) : null}
        <TextField
          label={type === "paid" ? "Ngày" : "Ngày học thử"}
          value={form.date}
          type="date"
          required
          onChange={(date) => setForm({ ...form, date })}
        />
        {type === "trial" ? (
          <TextField label="Ngày kết thúc" value={form.trialEndDate} type="date" required onChange={(trialEndDate) => setForm({ ...form, trialEndDate })} />
        ) : null}
        <TextField label="Ghi chú" value={form.note} onChange={(note) => setForm({ ...form, note })} />
        {type === "paid" ? (
          <div className="form-summary">
            <span>Snapshot hoa hồng</span>
            <strong>{Math.round((activeCtv?.commissionRate ?? state.settings.defaultCommissionRate) * 100)}%</strong>
            <span>Anh nhận</span>
            <strong>{currency(estimatedShare)}</strong>
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="button ghost" type="button" onClick={onClose}>
            <X size={17} />
            <span>Hủy</span>
          </button>
          <button className="button primary" type="submit">
            <Save size={17} />
            <span>{type === "paid" ? "Lưu giao dịch" : "Lưu học thử"}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" type="button" title="Đóng" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  required = false,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="field-label">
      {label}
      <input
        className="input"
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-label">
      {label}
      <select className="select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function GroupSearchField({
  label,
  value,
  groups,
  onChange,
}: {
  label: string;
  value: string;
  groups: CourseGroup[];
  onChange: (value: string) => void;
}) {
  const selectedGroup = groups.find((group) => group.id === value);
  const selectedLabel = selectedGroup ? `${selectedGroup.name} · ${selectedGroup.groupEmail}` : "";
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [searchValue, setSearchValue] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchValue(selectedLabel);
  }, [selectedLabel]);

  useEffect(() => {
    setActiveIndex(0);
  }, [searchValue, groups]);

  const filteredGroups = useMemo(() => {
    const normalized = searchValue.trim().toLowerCase();
    if (!normalized || normalized === selectedLabel.toLowerCase()) return groups.slice(0, 80);
    const terms = normalized.split(/\s+/).filter(Boolean);
    return groups
      .filter((group) => {
        const haystack = [
          group.name,
          group.groupEmail,
          group.subject,
          group.teacher,
          group.kind,
          String(group.priceHint),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .slice(0, 80);
  }, [groups, searchValue, selectedLabel]);

  function chooseGroup(group: CourseGroup) {
    onChange(group.id);
    setSearchValue(`${group.name} · ${group.groupEmail}`);
    setOpen(false);
  }

  function clearSearch() {
    setSearchValue("");
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <label className="field-label searchable-field">
      {label}
      <div className="searchable-select">
        <Search className="searchable-select-icon" size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          className="input searchable-select-input"
          type="text"
          value={searchValue}
          placeholder="Tìm tên nhóm, email, môn, giáo viên"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          onFocus={(event) => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            event.currentTarget.select();
            setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => {
              setOpen(false);
              setSearchValue(selectedLabel);
            }, 120);
          }}
          onChange={(event) => {
            setSearchValue(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => Math.min(current + 1, Math.max(filteredGroups.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter" && open) {
              const group = filteredGroups[activeIndex];
              if (group) {
                event.preventDefault();
                chooseGroup(group);
              }
            } else if (event.key === "Escape") {
              setOpen(false);
              setSearchValue(selectedLabel);
            }
          }}
        />
        {searchValue ? (
          <button
            className="searchable-select-clear"
            type="button"
            aria-label="Xóa nội dung tìm nhóm"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearSearch}
          >
            <X size={15} />
          </button>
        ) : null}
        {open ? (
          <div className="searchable-select-menu" id={listboxId} role="listbox">
            {filteredGroups.length ? (
              filteredGroups.map((group, index) => (
                <button
                  key={group.id}
                  type="button"
                  className={group.id === value || index === activeIndex ? "active" : ""}
                  role="option"
                  aria-selected={group.id === value}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => chooseGroup(group)}
                >
                  <strong>{group.name}</strong>
                  <span>{group.groupEmail}</span>
                  <small>
                    {[groupKindLabel(group.kind), group.subject, group.teacher].filter(Boolean).join(" · ")}
                  </small>
                </button>
              ))
            ) : (
              <div className="searchable-select-empty">Không tìm thấy nhóm phù hợp.</div>
            )}
          </div>
        ) : null}
      </div>
    </label>
  );
}

function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
  negative = false,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: "blue" | "green" | "amber" | "slate";
  negative?: boolean;
}) {
  return (
    <section className={`metric-card ${tone}${negative ? " negative" : ""}`}>
      <div className="metric-icon">
        <Icon size={20} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}

function PanelHeader({ title, action }: { title: string; action?: string }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      {action ? <span>{action}</span> : null}
    </div>
  );
}

function DataTable({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="table-wrap">
      <table className={className ? `data-table ${className}` : "data-table"}>{children}</table>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="empty-state">{label}</div>;
}

function EmptyTableRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr className="empty-table-row">
      <td colSpan={colSpan}>
        <EmptyState label={label} />
      </td>
    </tr>
  );
}

function FilterBar({
  state,
  ctvFilter,
  onCtvFilter,
  right,
}: {
  state: AppState;
  ctvFilter: string;
  onCtvFilter: (id: string) => void;
  right?: React.ReactNode;
}) {
  return (
    <div className="filter-bar">
      <label className="inline-filter">
        <SlidersHorizontal size={17} aria-hidden="true" />
        <select
          aria-label="Lọc theo CTV"
          value={ctvFilter}
          onChange={(event) => onCtvFilter(event.target.value)}
        >
          <option value="all">Tất cả CTV</option>
          {state.ctvs.map((ctv) => (
            <option key={ctv.id} value={ctv.id}>
              {ctv.name}
            </option>
          ))}
        </select>
      </label>
      {right}
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "active" : ""}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <StatusBadge variant={status === "received" ? "success" : "warning"}>
      {status === "received" ? "Đã trả" : "Chưa trả"}
    </StatusBadge>
  );
}

function JobBadge({ status }: { status: JobStatus }) {
  const variant =
    status === "done"
      ? "success"
      : status === "failed" || status === "needs_session"
        ? "danger"
        : status === "running"
          ? "info"
          : "warning";
  return <StatusBadge variant={variant}>{statusLabel(status)}</StatusBadge>;
}

function StatusBadge({
  variant,
  children,
}: {
  variant: "success" | "warning" | "danger" | "info";
  children: React.ReactNode;
}) {
  return <span className={`status-badge ${variant}`}>{children}</span>;
}

function InlineStat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "inline-stat strong" : "inline-stat"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type TrendPoint = { date: string; revenue: number; share: number };
type TrendRange = 30 | 90 | 180 | "all";

const trendRangeOptions: Array<{ value: TrendRange; label: string }> = [
  { value: 30, label: "30 ngày" },
  { value: 90, label: "90 ngày" },
  { value: 180, label: "180 ngày" },
  { value: "all", label: "Tất cả" },
];

function compactMoney(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const format = (amount: number, digits = 1) =>
    amount.toLocaleString("vi-VN", {
      maximumFractionDigits: digits,
      minimumFractionDigits: amount < 10 && amount % 1 !== 0 ? 1 : 0,
    });

  if (abs >= 1_000_000_000) return `${sign}${format(abs / 1_000_000_000)} tỷ`;
  if (abs >= 1_000_000) return `${sign}${format(abs / 1_000_000)}tr`;
  if (abs >= 1_000) return `${sign}${format(abs / 1_000)}k`;
  return `${sign}${format(abs, 0)}đ`;
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [range, setRange] = useState<TrendRange>(30);

  if (!data.length) {
    return <EmptyState label="Chưa có doanh thu." />;
  }

  const visibleData = range === "all" ? data : data.slice(-range);
  const padX = 8;
  const spanX = 100 - padX * 2;
  const topY = 18;
  const baseY = 76;
  const max = Math.max(...visibleData.map((item) => item.share), 1);
  const xAt = (index: number) =>
    visibleData.length === 1 ? 50 : padX + (index / (visibleData.length - 1)) * spanX;
  const yAt = (value: number) => baseY - (value / max) * (baseY - topY);

  const line = visibleData.map((item, index) => `${xAt(index)},${yAt(item.share)}`).join(" ");
  const area = `M${xAt(0)} ${baseY} L${line.replaceAll(" ", " L")} L${xAt(visibleData.length - 1)} ${baseY} Z`;

  const totalShare = visibleData.reduce((sum, item) => sum + item.share, 0);
  const totalRevenue = visibleData.reduce((sum, item) => sum + item.revenue, 0);
  const avgShare = Math.round(totalShare / visibleData.length);
  const bestIndex = visibleData.reduce((best, item, index) => (item.share > visibleData[best].share ? index : best), 0);
  const firstDate = shortDate(visibleData[0].date).slice(0, 5);
  const lastDate = shortDate(visibleData[visibleData.length - 1].date).slice(0, 5);
  const rangeLabel = visibleData.length === 1 ? firstDate : `${firstDate} - ${lastDate}`;

  const labelCount = visibleData.length <= 12 ? visibleData.length : visibleData.length <= 45 ? 6 : visibleData.length <= 120 ? 5 : 6;
  const labelIndexes = Array.from(
    new Set(
      Array.from({ length: labelCount }, (_, index) =>
        labelCount <= 1 ? 0 : Math.round((index * (visibleData.length - 1)) / (labelCount - 1)),
      ),
    ),
  );
  const pointLabelCount = visibleData.length <= 8 ? visibleData.length : visibleData.length <= 45 ? 8 : 6;
  const pointLabelIndexes = Array.from(
    new Set(
      Array.from({ length: pointLabelCount }, (_, index) =>
        pointLabelCount <= 1 ? 0 : Math.round((index * (visibleData.length - 1)) / (pointLabelCount - 1)),
      ),
    ),
  );

  const activeItem = active != null ? visibleData[active] ?? null : null;
  const activeLabelIndex = active != null && !pointLabelIndexes.includes(active) ? active : null;
  const positiveDays = visibleData.filter((item) => item.share > 0).length;
  const statItems = [
    { label: "Doanh số", value: currency(totalRevenue), note: "Tổng học phí" },
    { label: "TB/ngày", value: currency(avgShare), note: `${positiveDays}/${visibleData.length} ngày có thu` },
    {
      label: `Cao nhất · ${shortDate(visibleData[bestIndex].date).slice(0, 5)}`,
      value: currency(visibleData[bestIndex].share),
      note: "Đỉnh trong kỳ",
    },
  ];

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    if (visibleData.length === 1) return setActive(0);
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setActive(Math.round(ratio * (visibleData.length - 1)));
  };

  return (
    <div className="trend-chart">
      <div className="trend-chart-header">
        <div className="trend-chart-range">
          <span>{visibleData.length}/{data.length} ngày</span>
          <strong>{rangeLabel}</strong>
          <small>Thu nhập hiển thị theo đường line</small>
        </div>
        <div className="chart-range-tabs" role="group" aria-label="Khoảng thời gian doanh thu">
          {trendRangeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={range === option.value ? "active" : ""}
              aria-pressed={range === option.value}
              onClick={() => {
                setRange(option.value);
                setActive(null);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-overview">
        <div className="chart-overview-main">
          <span>Anh nhận trong kỳ</span>
          <strong>{currency(totalShare)}</strong>
          <small>{positiveDays}/{visibleData.length} ngày phát sinh doanh thu</small>
        </div>
        <div className="chart-stats">
          {statItems.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.note}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-body">
        <div className="chart-plot-card excel-line-card">
          <div className="chart-plot-toolbar">
            <span>Thu nhập theo ngày</span>
            <strong>
              {activeItem
                ? `${shortDate(activeItem.date)} · ${currency(activeItem.share)}`
                : `Đỉnh ${currency(visibleData[bestIndex].share)}`}
            </strong>
          </div>
          <div className="chart-plot excel-line-plot" onMouseMove={onMove} onMouseLeave={() => setActive(null)}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Biểu đồ doanh thu theo ngày">
              <path d={`M${padX} ${topY} H${100 - padX}`} className="chart-grid light" />
              <path d={`M${padX} ${(topY + baseY) / 2} H${100 - padX}`} className="chart-grid" />
              <path d={`M${padX} ${baseY} H${100 - padX}`} className="chart-axis" />
              <path d={area} className="chart-area" />
              <polyline points={line} className="chart-line" />
              {activeItem ? (
                <>
                  <path d={`M${xAt(active as number)} ${topY} V${baseY}`} className="chart-guide" />
                  <circle cx={xAt(active as number)} cy={yAt(activeItem.share)} r="2.25" className="chart-dot active" />
                </>
              ) : null}
            </svg>
            <div className="chart-value-labels" aria-hidden="true">
              {pointLabelIndexes.map((index) => (
                <span
                  key={index}
                  className="chart-value-label"
                  style={{ left: `${xAt(index)}%`, top: `${yAt(visibleData[index].share)}%` }}
                >
                  {compactMoney(visibleData[index].share)}
                </span>
              ))}
              {activeLabelIndex != null ? (
                <span
                  className="chart-value-label active"
                  style={{ left: `${xAt(activeLabelIndex)}%`, top: `${yAt(visibleData[activeLabelIndex].share)}%` }}
                >
                  {compactMoney(visibleData[activeLabelIndex].share)}
                </span>
              ) : null}
            </div>
            {activeItem ? (
              <div
                className="chart-tooltip"
                style={{ left: `${xAt(active as number)}%` }}
                data-flip={xAt(active as number) > 65 ? "left" : xAt(active as number) < 35 ? "right" : "center"}
              >
                <span>{shortDate(activeItem.date)}</span>
                <strong>{currency(activeItem.share)}</strong>
                <small>{currency(activeItem.revenue)} doanh số</small>
              </div>
            ) : null}
            <div className="chart-xlabels">
              {labelIndexes.map((index) => (
                <span key={index} style={{ left: `${xAt(index)}%` }}>
                  {shortDate(visibleData[index].date).slice(0, 5)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminStatusCard({ status }: { status: AdminSdkState }) {
  const account =
    status.state === "ready"
      ? status.details.impersonateEmail
      : status.state === "checking"
        ? "Đang kiểm tra"
        : "Cần cấu hình";

  return (
    <div className="admin-status-card">
      <ShieldCheck size={18} />
      <div>
        <strong>Admin SDK</strong>
        <span>{account}</span>
        <AdminStatusInline status={status} />
      </div>
    </div>
  );
}

function UserCard({ session }: { session: ClientSession }) {
  return (
    <div className="admin-status-card user-card">
      <div className="user-avatar">{session.name.slice(0, 1).toUpperCase()}</div>
      <div>
        <strong>{session.name}</strong>
        <span>{session.email}</span>
        <StatusBadge variant={session.role === "admin" ? "info" : "success"}>
          {session.role === "admin" ? "Quản trị viên" : "Cộng tác viên"}
        </StatusBadge>
      </div>
      <a className="user-logout" href="/api/auth/logout" title="Đăng xuất">
        <LogOut size={16} />
      </a>
    </div>
  );
}

/**
 * Sheet "Thêm" ở mobile: chứa các view không ghim ở thanh dưới cùng nút Đăng xuất.
 * Không có sheet này thì trên điện thoại (sidebar bị display:none) các view
 * Dòng tiền / CTV / Học viên / Cài đặt và nút Đăng xuất đều không bấm được.
 */
function MobileMoreSheet({
  items,
  activeView,
  session,
  isAdmin,
  onSelect,
  onClose,
}: {
  items: NavItem[];
  activeView: ViewKey;
  session: ClientSession;
  isAdmin: boolean;
  onSelect: (view: ViewKey) => void;
  onClose: () => void;
}) {
  return (
    <div className="mobile-sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="mobile-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Menu điều hướng"
        onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
      >
        <div className="mobile-sheet-head">
          <div className="mobile-sheet-user">
            <div className="user-avatar">{session.name.slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{session.name}</strong>
              <span>{session.email}</span>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Đóng menu">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {items.length ? (
          <div className="mobile-sheet-grid">
            {items.map((item) => (
              <button
                key={item.key}
                className={activeView === item.key ? "mobile-sheet-item active" : "mobile-sheet-item"}
                onClick={() => onSelect(item.key)}
                aria-current={activeView === item.key ? "page" : undefined}
                type="button"
              >
                <item.icon size={19} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="mobile-sheet-foot">
          <span className="status-badge info">{isAdmin ? "Quản trị viên" : "Cộng tác viên"}</span>
          <a className="button ghost" href="/api/auth/logout">
            <LogOut size={17} aria-hidden="true" />
            <span>Đăng xuất</span>
          </a>
        </div>
      </div>
    </div>
  );
}

