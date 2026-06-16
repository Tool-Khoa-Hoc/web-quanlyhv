# PLAN TO�N DI?N � Web App Qu?n L� B�n Kh�a H?c & Google Group

> Phi�n b?n n�y thay th? plan script tr??c (`PLAN-tool-quan-ly-khoa-hoc.md`). ?�y l� plan cho **web application** ho�n ch?nh. Ph?n code tri?n khai s? l�m sau, b�m theo plan n�y.

---

## 1. M?c ti�u s?n ph?m
M?t web app n?i b? (1 admin = anh) ??:
1. **Qu?n l� h?c vi�n & ??ng k� kh�a h?c** (??ng k� tr? ph� + h?c th?).
2. **Qu?n l� c?ng t�c vi�n (CTV)** v� **d�ng ti?n**: ai ?� chuy?n 50% cho anh, ai ch?a, c�n n? bao nhi�u.
3. **T? ??ng th�m/x�a h?c vi�n trong Google Group** (consumer @googlegroups.com) b?ng ch�nh t�i kho?n Google c?a anh.
4. **T�ch h?p gi?i captcha** (theo API Postman anh cung c?p) l�m d? ph�ng cho automation.
5. **Dashboard** th?ng k� doanh thu, c�ng n?, t? l? chuy?n ??i h?c th?.

S? li?u ???c s? h�a t? file `quan-ly-ban-khoa-hoc.xlsx` (2 sheet: *Giao d?ch*, *H?c th?*).

---

## 2. Nghi?p v? (r�t ra t? Excel)

### M� h�nh kinh doanh
- **CTV** gi?i thi?u/b�n kh�a cho **h?c vi�n** (??nh danh b?ng Gmail).
- H?c vi�n th??ng **h?c th?** tr??c ? n?u OK th� **??ng k� tr? ph�**.
- M?i kh�a tr? ph�: h?c vi�n ?�ng **h?c ph�**, anh h??ng **t? l? hoa h?ng � m?c ??nh 50%, ch?nh ???c cho t?ng CTV c? th?** (l?u `commission_rate` tr�n m?i CTV). T? l? ???c **ch?t c?ng (snapshot) v�o t?ng giao d?ch l�c t?o** ? ??i t? l? CTV v? sau kh�ng l�m sai s? li?u c?.
- CTV thu ti?n r?i **chuy?n ph?n c?a anh** ? c?n theo d�i *?� chuy?n / ch?a chuy?n*.
- H?c vi�n ?� ??ng k� ? ???c th�m v�o **Google Group** t??ng ?ng (theo m�n/gi�o vi�n/combo). H?c th? ? v�o nh�m **"H?c Th? +Admin"**, h?t h?n kh�ng ??ng k� th� **x�a kh?i nh�m**.

### D? li?u t? sheet "Giao d?ch"
T?ng h?p: *T? l? anh nh?n (0.5), Anh ?�ng nh?n, ?� thu, C�n n? � CH?A TR?, S? kh�a ch?a tr?.*
C?t: `STT | Ng�y | CTV | Gmail h?c vi�n | M�n/Combo | Lo?i kh�a | H?c ph� | Anh nh?n 50% | Ti?n ?� nh?n? (R?i/Ch?a) | Ng�y nh?n ti?n | T�nh tr?ng (? ?� tr?/? Ch?a tr?) | Ghi ch�`

### D? li?u t? sheet "H?c th?"
T?ng h?p: *T?ng h?c th?, ?ang th?, ?� ??ng k�, Kh�ng ??ng k�, T? l? chuy?n ??i.*
C?t: `STT | Ng�y h?c th? | CTV | Gmail/H?c vi�n | M�n/Combo | K?t qu? (?ang th?/?� ??ng k�/Kh�ng ??ng k�) | Ng�y k?t th�c th? | Ghi ch�`

### Google Groups (t? ?nh "My groups" � 31 nh�m)
- Theo **cohort** (2K9), **m�n** (Anh, To�n, L�, H�a, Sinh, S?...), **gi�o vi�n** (C� Ph?m Li?u TENS, C� Trang Anh MOON, Th?y V? Ng?c Anh MAPSTUDY...), **combo** (Combo THPT Full, Combo THPT + ?GNL).
- Nh�m ??c bi?t **"H?c Th? +Admin"** (`hoc-thu-khoa-hoc`) cho h?c vi�n h?c th?.
- Member c� role **Owner / Manager / Member**. T�i kho?n anh (`tamatm6713@gmail.com`) l� **Manager** ? ?? quy?n add/remove member.

---

## 3. ?? ?i?m ki?n tr�c quan tr?ng nh?t � 2 c? ch? Google KH�C NHAU

Anh mu?n *"d�ng t�i kho?n Google ?? ??ng nh?p v� d�ng ch�nh t�i kho?n ?� ?? th�m/x�a member"*. V? m?t k? thu?t ?�y l� **2 c? ch? t�ch bi?t** (d� c�ng 1 t�i kho?n Google):

| | (A) ??ng nh?p web app | (B) Qu?n l� member Google Group |
|---|---|---|
| C? ch? | **Google OAuth** (Sign in with Google) | **HTTP RPC** d�ng **cookie session ?� l?u** (KH�NG browser) |
| Cho ra | Danh t�nh (bi?t anh l� ai) | Quy?n g?i th?ng request th�m/x�a member c?a groups.google.com |
| V� sao | ??ng nh?p an to�n, chu?n | **Google Group consumer (@googlegroups.com) KH�NG c� API qu?n l� member.** Admin SDK Directory API ch? ch?y v?i **Google Workspace** (anh kh�ng c�). ? T�i hi?n request n?i b? (`batchexecute`) m� giao di?n web g?i. |
| Captcha? | Kh�ng | RPC ?� ??ng nh?p ? h?u nh? kh�ng d�nh ? **2captcha ch? l� t�y ch?n d? ph�ng** |

**K?t lu?n:** OAuth token ??ng nh?p **kh�ng** d�ng ?? add/remove member ???c. Ph?i l?u **cookie session Google** ri�ng (l?y 1 l?n tr�n m�y anh, m� h�a) cho worker d�ng ?? g?i HTTP RPC. C? hai c� th? l� **c�ng 1 t�i kho?n Gmail**, nh?ng l� 2 lu?ng k? thu?t ri�ng.

### C�ch add/x�a member KH�NG c?n Chromium (?� ch?t � H??ng 2 "HTTP RPC")
Khi b?m "Add members" tr�n web, Google g?i m?t request n?i b? `POST .../batchexecute` (k�m token XSRF `at` l?y t? HTML trang + cookie phi�n). Tool **t�i hi?n ?�ng request ?� b?ng HTTP client th??ng** ? kh�ng c?n m? browser, nh?, nhanh.

- ? Kh�ng Chromium ? VPS nh?, kh�ng c?n c�i browser.
- ? H?u nh? kh�ng g?p reCAPTCHA (v� l� XHR ?� ??ng nh?p).
- ?? D?a v�o **RPC n?i b? kh�ng c�ng khai** ? Google ??i l� ph?i s?a.
- ?? L�c build ph?i **capture 1 l?n** request add/remove member th?t (DevTools) ?? l?y ?�ng `rpcid` + c?u tr�c payload.
- ?? Cookie session **h?t h?n** ??nh k? ? l?y l?i; tool t? ph�t hi?n & b�o.

> ? *Ph??ng �n d? ph�ng n?u RPC v?:* (a) ch?y **headless browser** (Chromium/Firefox) nh? c? � n?ng h?n nh?ng b?n v?i thay ??i UI; (b) n?u sau n�y l�n **Google Workspace** th� d�ng Admin SDK API l� s?ch nh?t. Module group-sync t�ch interface ?? thay backend d? d�ng.

### 3b. Thi?t k? ??ng nh?p & k?t n?i Google � HO�N TO�N TR�N WEB

C� **2 l?n ??ng nh?p ri�ng bi?t**:

**A. ??ng nh?p v�o web app � "Sign in with Google" (OAuth):** b?m 1 n�t, ??ng nh?p Google b�nh th??ng ? v�o app. (NextAuth + allowlist email c?a anh.)

**B. K?t n?i t�i kho?n qu?n l� nh�m � ??ng nh?p ngay trong app, KH�NG m? Chrome, KH�NG t�m/d�n cookie**

> ?? **Gi?i h?n b?o m?t ph?i hi?u:** trang web ? domain c?a app **kh�ng th? ??c cookie google.com** trong tr�nh duy?t c?a anh (ch?n b?i same-origin + httpOnly). ? Kh�ng c� c�ch n�o ?? m?t trang web "t? m�c cookie Google" t? tab c?a anh. **B?t bu?c** vi?c ??ng nh?p ph?i di?n ra trong **m?t tr�nh duy?t do server ?i?u khi?n** th� server m?i ??c ???c cookie k?t qu?. (OAuth c?a (A) c?ng kh�ng thay ???c � kh�ng c� scope Google n�o ch?m consumer group.)

**Lu?ng "K?t n?i Google" (1 l?n, full web):**
1. Anh b?m **"K?t n?i Google"** trong app.
2. Backend m? m?t **phi�n tr�nh duy?t do server/cloud ?i?u khi?n**, v�o th?ng `accounts.google.com`.
3. App **nh�ng m�n h�nh tr�nh duy?t ?� (live view t??ng t�c)** v�o c?a s? trong app ? anh **??ng nh?p t�i kho?n ph? b�nh th??ng** (email, m?t kh?u, 2FA) ngay t?i ?�.
4. ??ng nh?p xong ? **server t? ??c cookie t? ch�nh tr�nh duy?t n� ?i?u khi?n** ? m� h�a l?u `google_session` ? ?�ng phi�n.
5. Xong � kh�ng m? Chrome m�y anh, kh�ng DevTools, kh�ng copy cookie.

*(Kh�ng iframe tr?c ti?p `accounts.google.com` ???c � Google ch?n nh�ng. "Live view" l� lu?ng h�nh ?nh + ?i?u khi?n c?a browser t? xa, kh�ng ph?i iframe c?a Google.)*

> ? **V� anh ch?y app tr�n MOBILE (quan tr?ng � ch?t):**
> - Anh **KH�NG bao gi? t? l?y/d�n cookie**. "Cookie" l� vi?c **server t? ??c** sau khi anh ??ng nh?p trong m�n nh�ng. Tr�n mobile kh�ng l?y ???c cookie th? c�ng � v� **kh�ng c?n**, v� lu?ng n�y kh�ng y�u c?u ?i?u ?�.
> - **H?ng ng�y tr�n ?i?n tho?i = ch? OAuth.** B?m "Sign in with Google" ? v�o app nh?p li?u. Vi?c th�m/x�a Google Group **ch?y ng?m tr�n server** b?ng session ?� l?u ? **kh�ng re-login Google, kh�ng cookie**.
> - **B??c "K?t n?i Google" (1 l?n / nhi?u tu?n�th�ng):** l�m ngay tr�n mobile trong m�n live view (ch?m + g� nh? trang login th??ng); **ho?c** l�m 1 l?n t? m?t m�y t�nh cho d? g� 2FA. Session l?u **? server** n�n l�m t? thi?t b? n�o c?ng ???c, sau ?� d�ng app **100% tr�n mobile**.
> - **V� sao kh�ng th? ch? d�ng OAuth cho vi?c qu?n l� nh�m:** Google **kh�ng c� scope OAuth** n�o cho consumer @googlegroups.com ? token OAuth kh�ng add/x�a member ???c. ?�y l� gi?i h?n c?a Google. N�n v?n c?n session (B) � nh?ng anh ch? "??ng nh?p", kh�ng ??ng cookie.

**Ch?y tr�nh duy?t ??ng nh?p ?� ? ?�u � ? ?� CH?T: D?ch v? remote-browser qu?n l�**
- **(?� CH?T) Steel.dev** � d?ch v? remote-browser **m� ngu?n m?**, c� live-view nh�ng + SDK + free tier. L� do ch?n: free tier ?? cho m?c d�ng v�i ph�t/th�ng (? $0), **d? b?t ??u** (ch? API + nh�ng viewer, kh�ng c�i g�), v� v� OSS n�n **c� ???ng lui t? host $0** n?u c?n. **VPS nh?, kh�ng c�i Chromium**; b?t proxy d�n c? + gi?i captcha c?a Steel ?? Google �t l�m kh�. *C?n x�c nh?n free-tier/gi� 2026 khi ??ng k�.*
- **Code t�ch interface `RemoteBrowserConnect`** ? ??i sang Browserbase / t? host Steel sau m� kh�ng ph� ki?n tr�c.
- *Ph??ng �n thay th?:* **Browserbase** (d?, docs/SDK t?t, free tier t??ng ???ng � ch? thua ? ch? kh�ng t? host ???c). Ho?c **t? host Steel/noVNC** (Docker, launch on-demand) n?u mu?n $0 tuy?t ??i + gi? ??ng nh?p tr�n VPS ri�ng � nh?ng t?n c�ng d?ng h?n.

**Sau khi k?t n?i:** th�m/x�a member h?ng ng�y **ch? d�ng cookie qua HTTP RPC � KH�NG c?n browser**. Worker **l?u cookie xoay v�ng** (Google t? gia h?n `__Secure-1PSIDTS`�) ? session s?ng **h�ng tu?n�th�ng**. Khi Google v� hi?u h?n ? app hi?n banner, anh b?m **"K?t n?i l?i"** (l?p l?i lu?ng tr�n, v?n full web).

**R?i ro c?n bi?t (n�i th?ng):**
- ??ng nh?p t? **IP cloud/datacenter** d? b? Google h?i x�c minh th�m ? v� anh login **tr?c ti?p trong live view** n�n gi?i t?i ch? ???c; d?ch v? remote-browser c� proxy d�n c? ?? gi?m.
- V?i d?ch v? qu?n l�, anh **g� m?t kh?u Google trong browser c?a b�n th? 3** ? d�ng **t�i kho?n ph? chuy�n d?ng**; mu?n tr�nh ho�n to�n th� ch?n **t? host noVNC**.

**Ph??ng �n thay th? (kh�ng "full web"):** extension tr�nh duy?t 1-click t? ??c cookie, ho?c helper desktop ch?y 1 l?n � ph?i c�i th�m, n�n ch? ?? d? ph�ng.

---

## 4. Ki?n tr�c h? th?ng

```
???????????????     HTTPS      ????????????????????????
?  Frontend   ? ?????????????? ?   Backend API        ?
?  (web UI)   ? ?????????????? ?   (REST)             ?
???????????????                ?  - Auth (Google OAuth)?
                               ?  - Nghi?p v?/CRUD     ?
                               ?  - T?o job automation ?
                               ????????????????????????
                                       ? ??c/ghi
                                  ????????????
                                  ? Database ?  CTV, h?c vi�n, kh�a,
                                  ?          ?  giao d?ch, c�ng n?,
                                  ?          ?  job queue, session
                                  ????????????
                            poll/l?y job?
                               ?????????????????????      ????????????????????
                               ? Sync Worker       ????? ? Captcha (t�y ch?n)?
                               ? HTTP RPC client   ?     ? ch? khi b? challenge?
                               ? + cookie session  ?     ????????????????????
                               ?????????????????????
                                        ? POST batchexecute (HTTP, kh�ng browser)
                                  ??????????????????
                                  ? groups.google. ?
                                  ? com (RPC n?i b?)?
                                  ??????????????????
```

**V� sao t�ch Worker + h�ng ??i (queue):** automation ch?y ch?m (m? browser, ch? trang), ph?i **gi?i h?n t?c ?? + ch?y tu?n t?** ?? tr�nh b? Google ch?n. Thao t�c tr�n UI (b?m "th�m 50 h?c vi�n") ch? **??y job v�o queue**; worker x? l� n?n, c� delay nh? ng??i th?t, retry khi l?i. UI kh�ng b? treo.

---

## 5. Tech stack (?� CH?T)

> **Quy?t ??nh:** TypeScript/Next.js � hosted nh? web app (VPS/cloud ch?y 24/7) � t�i kho?n Google **ph? chuy�n d?ng** ch? l�m Manager nh�m.


| L?p | L?a ch?n ?? xu?t | Thay th? |
|---|---|---|
| Frontend | **Next.js + React + TypeScript** (Tailwind UI) | Vue/Nuxt |
| Backend | **Next.js API routes** (c�ng repo) | NestJS / FastAPI (Python) |
| DB | **PostgreSQL** (prod) / SQLite (ch?y local) + **Prisma ORM** | MySQL |
| Auth | **NextAuth** (Google provider, gi?i h?n email allowlist) | Clerk |
| Queue/Job | **B?ng job trong DB** + worker poll (??n gi?n) | BullMQ + Redis (n?u c?n scale) |
| K?t n?i Google (1 l?n) | **Steel.dev** (remote-browser OSS) + live view nh�ng � ?� CH?T | Browserbase � t? host Steel/noVNC � interface `RemoteBrowserConnect` ?? ??i |
| Group sync (h?ng ng�y) | **HTTP client** (fetch/undici) g?i RPC `batchexecute` � KH�NG browser | Playwright (fallback n?u RPC v?) |
| Captcha | **Anh t? gi?i tay** trong live view � KH�NG auto-solver | autocaptcha.pro (?nh-ch?) ?? d�nh � Ph? l?c A |
| M� h�a session | AES-256-GCM, key t? bi?n m�i tr??ng/secret | KMS |

*?� ch?t TypeScript end-to-end ?? worker Playwright v� backend d�ng chung code/model.*

**Hosting (?� ch?t � ch?y nh? web app):** deploy l�n **VPS/cloud ch?y 24/7** (VD Hetzner/DigitalOcean/Vultr, ~v�i ch?c�tr?m ngh�n/th�ng) ?? truy c?p t? tr�nh duy?t m?i l�c v� worker ch?y n?n li�n t?c. V� H??ng 2 **kh�ng c?n Chromium**, VPS c� th? **r?t nh?** (RAM th?p c?ng ??). Worker n�n l� **process ri�ng ch?y li�n t?c** (gi? h�ng ??i + session) � n?u d�ng fallback Playwright th� server m?i c?n c�i browser. M� h�nh deploy: Next.js (web) + worker (process ri�ng) + Postgres, ?�ng g�i b?ng Docker. *Dev local tr??c, l�n VPS khi go-live.*

---

## 6. M� h�nh d? li?u (DB schema)

```
users          (admin ??ng nh?p qua Google OAuth)
  id, google_email, name, role, created_at

ctv            (c?ng t�c vi�n)
  id, code (VD "CTV A"), name, phone, bank_info,
  commission_rate (m?c ??nh 0.5), active, note

course_group   (1 d�ng = 1 Google Group / kh�a)
  id, name, group_email, subject, teacher, cohort (2K9),
  type (single | combo | full | trial), default_price, active
  -- ??ng b? t? ??ng t? "My groups"

student
  id, gmail, name, phone, note, created_at

enrollment     (1 ??ng k� c?a h?c vi�n)
  id, student_id, ctv_id, kind (trial | paid),
  course_label (M�n/Combo), date, status,
  -- trial: trial_start, trial_end, trial_result (dang_thu|da_dang_ky|khong_dang_ky)
  fee (h?c ph�), commission_rate_snapshot, owner_share (= fee * rate snapshot)

enrollment_group  (h?c vi�n-c?a-??ng-k� n�n ? nh?ng nh�m n�o)
  id, enrollment_id, course_group_id,
  membership_status (pending | added | removed | failed),
  last_action_at

payment        (CTV chuy?n ph?n c?a anh � theo t?ng ??ng k�)
  id, enrollment_id, ctv_id, amount (owner_share),
  received (bool), received_date, status (?/?), note

group_job      (h�ng ??i + log automation)
  id, type (add_member | remove_member), course_group_id, student_gmail,
  status (queued|running|done|failed|needs_captcha),
  attempts, error, captcha_used (bool), created_at, finished_at

google_session (session automation)
  id, account_email, storage_state_encrypted, valid,
  last_verified_at

app_setting    (c?u h�nh)
  captcha_api_key, default_rate, min_delay, max_delay, allowlist_emails...
```

Quan h?: `ctv 1�n enrollment`, `student 1�n enrollment`, `enrollment 1�n enrollment_group`, `enrollment 1�1 payment`, `course_group 1�n enrollment_group`, `course_group 1�n group_job`.

---

## 7. C�c m�n h�nh ch�nh (UI)

1. **Dashboard** � Anh ?�ng nh?n / ?� thu / C�n n? / S? kh�a ch?a tr?; t? l? chuy?n ??i h?c th?; c�ng n? theo t?ng CTV; doanh thu theo th?i gian.
2. **Giao d?ch** � b?ng gi?ng Excel: th�m/s?a ??ng k� tr? ph�, ?�nh d?u "?� nh?n ti?n", l?c theo CTV / t�nh tr?ng. N�t **"Th�m v�o nh�m"** ? t?o job automation.
3. **H?c th?** � b?ng h?c th?; ??t k?t qu?; n�t **"Chuy?n sang tr? ph�"** (t?o enrollment paid + job add nh�m kh�a + job remove nh�m h?c th?); c?nh b�o h?c th? **s?p h?t h?n**.
4. **CTV** � danh s�ch CTV, c�ng n? (?�ng nh?n / ?� nh?n / c�n n?), l?ch s? thanh to�n, ?�nh d?u ?� nh?n ti?n (??n l? ho?c g?p nhi?u giao d?ch).
5. **H?c vi�n** � danh s�ch, c�c ??ng k�, ?ang ? nh?ng nh�m n�o, l?ch s? add/remove.
6. **Nh�m / Kh�a h?c** � ??ng b? t? Google ("My groups"), g�n m�n/gi�o vi�n/gi�, xem member hi?n t?i.
7. **Automation / Jobs** � tr?ng th�i h�ng ??i, job l?i (retry), s? ki?n captcha, tr?ng th�i Google session (c�n s?ng/h?t h?n).
8. **C�i ??t** � thi?t l?p Google session (??ng nh?p 1 l?n), API key captcha, t? l? hoa h?ng, delay, allowlist email ??ng nh?p.

---

## 8. Lu?ng nghi?p v? ch�nh

- **A. Th�m h?c th?:** t?o enrollment(trial) ? enqueue `add_member` v�o "H?c Th? +Admin".
- **B. H?c th? ? ??ng k�:** ??t `trial_result = da_dang_ky` ? t?o enrollment(paid) + payment(?) ? enqueue `add_member` v�o (c�c) nh�m kh�a + (t�y ch?n) `remove_member` kh?i nh�m h?c th?.
- **C. H?c th? kh�ng ??ng k� / h?t h?n:** enqueue `remove_member` kh?i nh�m h?c th?.
- **D. CTV chuy?n ti?n:** ?�nh d?u payment `received` ? dashboard t? c?p nh?t c�ng n?.
- **E. H?y/ho�n:** enqueue `remove_member` kh?i nh�m t??ng ?ng.

---

## 9. Module Sync Worker (HTTP RPC � KH�NG Chromium) � chi ti?t

1. Worker l?y job `queued` (concurrency = 1).
2. N?p `google_session` (cookie ?� m� h�a) v�o HTTP client.
3. GET m?t trang groups.google.com ?? l?y **token XSRF `at`** (`SNlM0e` trong `WIZ_global_data`) + x�c ??nh `rpcid` cho add/remove.
4. **Add:** `POST .../_/.../batchexecute` v?i `f.req` = payload th�m member (email + role + ch? ?? "add directly").
   **Remove:** RPC t??ng ?ng v?i member c?n x�a.
5. ??c response ? ki?m tra th�nh c�ng/l?i. (N?u hi?m khi b? challenge ? g?i module captcha t�y ch?n.)
6. C?p nh?t `group_job` + `enrollment_group.membership_status`.
7. **Delay ng?u nhi�n 5�15s** gi?a job; retry l?i t?m th?i; n?u **session/`at` h?t h?n (401/403)** ? ?�nh d?u session ch?t, d?ng queue, b�o admin l?y cookie l?i.
8. **`rpcid` + c?u tr�c payload t�ch ra file config** ?? d? s?a khi Google ??i RPC. *(C?n capture 1 l?n t? DevTools l�c build ?? l?y ?�ng gi� tr?.)*

> **Fallback:** n?u RPC b? Google ??i v� kh� t�i hi?n, b?t module Playwright (drive UI nh? c?) � c�ng interface `GroupSync.add(email)/remove(email)`, ch? ??i c�i ??t b�n trong.

---

## 10. Captcha � anh T? GI?I TAY (kh�ng auto-solver)

> **Chi?n l??c (?� ch?t):** anh **t? gi?i to�n b? captcha b?ng tay** ? **kh�ng** t�ch h?p d?ch v? gi?i captcha t? ??ng cho lu?ng v?n h�nh.
>
> - **B??c K?t n?i/??ng nh?p Google:** l� **live view t??ng t�c** ? Google hi?n reCAPTCHA th� **anh t? tick/gi?i ngay trong app**. Kh�ng c?n API.
> - **Th�m/x�a member h?ng ng�y (HTTP RPC ch?y n?n):** authenticated XHR ? **h?u nh? kh�ng c� captcha**. N?u hi?m khi RPC tr? v? challenge, worker **kh�ng t? gi?i** m� **?�nh d?u session "c?n k?t n?i l?i" + b�o anh** ? anh m? live view ??ng nh?p/gi?i tay 1 l?n ? ch?y ti?p. **Kh�ng c� captcha n�o b? b? qua �m th?m.**

**autocaptcha.pro � KH�NG d�ng (?? d�nh):** ?� ??c doc `autocaptcha-pro-api.md` ? ?�y l� d?ch v? gi?i **?nh-ch? (imagetotext/OCR), 1 request**, **kh�ng gi?i Google reCAPTCHA**. Theo l?a ch?n t? gi?i tay c?a anh th� **hi?n kh�ng t�ch h?p**. Spec adapter l?u ? **Ph? l?c A** ?? b?t sau n?u xu?t hi?n captcha ?nh-ch? c?n t? ??ng.

---

## 11. B?o m?t
- **Google session cookie = ch�a kh�a to�n b? t�i kho?n Google** ? m� h�a AES-256 khi l?u, key ?? trong secret/bi?n m�i tr??ng, h?n ch? quy?n truy c?p server.
- **(?� CH?T) D�ng 1 t�i kho?n Google ph? chuy�n d?ng** ch? l�m **Manager** c?a c�c nh�m � kh�ng d�ng t�i kho?n ch�nh `tamatm6713`. C?n m?i t�i kho?n ph? n�y l�m Manager ? t?t c? nh�m c?n qu?n l�. N?u automation b? Google kh�a th� kh�ng ?nh h??ng t�i kho?n ch�nh.
- ??ng nh?p web app: Google OAuth + **allowlist email** (ch? anh v�o ???c).
- HTTPS, ch?ng CSRF, rate-limit API.
- Captcha API key & secrets kh�ng commit v�o code.

---

## 12. R?i ro & l?u �
- **ToS Google / r?i ro kh�a t�i kho?n** khi t? ??ng h�a ? gi?m thi?u: t�i d�ng session (kh�ng brute login), t?c ?? th?p, delay nh? ng??i th?t, d�ng t�i kho?n ph? chuy�n d?ng, volume nh? (v�i ch?c�tr?m � ph� h?p quy m� anh).
- **Ph? thu?c RPC n?i b? Google** (consumer group kh�ng c� API ch�nh th?c) ? Google ??i `rpcid`/payload l� ph?i s?a ? t�ch config, c� gi�m s�t/log + fallback Playwright.
- **Session/cookie h?t h?n** ??nh k? ? c?n lu?ng l?y l?i cookie + c?nh b�o khi session ch?t.
- **??ng nh?p qua remote-browser:** IP cloud c� th? b? Google b?t x�c minh th�m (gi?i tr?c ti?p trong live view); n?u d�ng d?ch v? qu?n l� th� m?t kh?u Google g� trong h? t?ng b�n th? 3 ? d�ng t�i kho?n ph?, ho?c t? host noVNC ?? gi? tr�n VPS c?a anh.
- **Captcha:** anh t? gi?i tay (trong live view) ? kh�ng t�ch h?p auto-solver, kh�ng t?n ph�/?? tr? captcha. R?i ro c�n l?i: n?u RPC n?n d�nh challenge th� job d?ng ch? anh k?t n?i l?i (?� c� c?nh b�o, kh�ng l?i �m th?m).
- **Hosting:** v� kh�ng c?n Chromium, VPS nh? l� ??; worker n�n l� process ch?y li�n t?c ?? gi? queue + session. (Ch? khi d�ng fallback Playwright m?i c?n server c� browser.)

---

## 13. L? tr�nh tri?n khai (?? xu?t theo gi� tr? gi?m d?n)

- **Phase 1 � N?n t?ng d? li?u:** schema DB **b�m theo c?u tr�c c?t c?a file Excel m?u**. D? li?u **nh?p tay h?ng ng�y trong app** (kh�ng c?n import l?n); ch? l�m **import 1 l?n (t�y ch?n)** n?u anh mu?n mang d? li?u c? sang. *(2�3 ng�y)*
- **Phase 2 � CRUD + Dashboard:** m�n Giao d?ch, H?c th?, CTV, H?c vi�n + dashboard c�ng n?/chuy?n ??i. **? ?� thay th? ???c Excel, d�ng ???c ngay d� ch?a c� automation.** *(4�6 ng�y)*
- **Phase 3 � ??ng b? Google Groups:** ??c danh s�ch nh�m + member, g�n m�n/gi�. *(2�3 ng�y)*
- **Phase 4 � K?t n?i Google (full web) + Sync worker:** m�n "K?t n?i Google" (remote-browser + live view nh�ng, server t? ??c cookie); capture request add/remove member 1 l?n; cookie session + queue + g?i RPC + delay/retry + auto-l?u cookie xoay v�ng. *(5�7 ng�y)*
- **Phase 5 � (?� B?) Captcha auto-solver:** anh t? gi?i tay ? kh�ng c?n. Ch? ??m b?o lu?ng "session c?n k?t n?i l?i" b�o r� cho anh (g?p v�o Phase 4).
- **Phase 6 � Ho�n thi?n:** thanh to�n g?p CTV, b�o c�o, th�ng b�o, x? l� l?i/bi�n. *(3�4 ng�y)*

> Phase 1�2 n�n l�m tr??c v� t?o gi� tr? ngay v� kh�ng ph? thu?c ph?n Google/automation r?i ro.

---

## 14. Quy?t ??nh & vi?c c?n chu?n b?

### ? ?� ch?t
1. **Tech stack:** TypeScript / Next.js (end-to-end).
2. **Hosting:** ch?y nh? web app tr�n VPS/cloud 24/7 (dev local tr??c, go-live l�n VPS).
3. **T�i kho?n Google automation:** t�i kho?n ph? chuy�n d?ng, ch? l�m Manager nh�m.

### ? V?a ch?t th�m
4. **Hoa h?ng:** m?c ??nh **50%, ch?nh ???c theo t?ng CTV** (snapshot v�o giao d?ch).
5. **Import:** Excel ch? ??nh ngh?a c?u tr�c; **nh?p tay h?ng ng�y trong app**; import bulk ch? l� t�y ch?n 1 l?n.
6. **Captcha:** **anh t? gi?i tay to�n b?** ? kh�ng t�ch h?p auto-solver. reCAPTCHA Google (n?u c�) gi?i trong **live view** l�c k?t n?i. ?� ??c doc `autocaptcha.pro` = gi?i **?nh-ch?**, kh�ng gi?i reCAPTCHA ? **?? d�nh** (Ph? l?c A), hi?n kh�ng d�ng.
7. **Multi-user:** giai ?o?n ??u **ch? m�nh anh** (1 admin). Schema c� s?n `role` ?? **b?t CTV t? ??ng nh?p sau** m� kh�ng ph?i ??p ?i l�m l?i.
8. **Anh d�ng app tr�n MOBILE ? login OAuth, KH�NG ??ng cookie:** daily = OAuth 1 n�t + nh?p li?u, group sync ch?y ng?m server b?ng session ?� l?u (kh�ng re-login, kh�ng cookie). B??c "K?t n?i Google" (1 l?n/nhi?u tu?n�th�ng) ch?y trong live view ngay tr�n mobile, ho?c l�m 1 l?n t? desktop (session l?u ? server). OAuth **kh�ng** thay ???c session qu?n l� nh�m v� Google kh�ng c� scope cho consumer group. Chi ti?t m?c 3b.

### ? T?t c? quy?t ??nh l?n ?� ch?t � s?n s�ng tri?n khai theo l? tr�nh m?c 13.

### ? Vi?c anh chu?n b? tr??c khi code (Phase 1+)
- T?o **t�i kho?n Gmail ph?** + m?i l�m **Manager** ? c�c nh�m c?n qu?n l�.
- ??ng k� **Steel.dev** (free tier) ?? l?y API key cho b??c K?t n?i Google.
- *(Kh�ng c?n API key captcha � anh t? gi?i tay.)*
- (Khi go-live) thu� **VPS** + t�n mi?n (t�y ch?n).

---

## Ph? l?c A � autocaptcha.pro (?? D�NH, hi?n kh�ng d�ng)

> L?u l?i ?? **b?t sau** n?u xu?t hi?n captcha **?nh-ch?** c?n t? gi?i. **Kh�ng gi?i Google reCAPTCHA.** Gi?i ??ng b? trong **1 request** (kh�ng submit-poll).

**Adapter `AutoCaptchaProClient`:**
- Base URL: `https://autocaptcha.pro/apiv3` � auth field/param **`key`**.
- **S? d?:** `GET /balance?key=KEY` ? `{ success, message, balance }`.
- **Gi?i:** `POST /process` (Content-Type: application/json):
  - *imagetotext:* `{ key, type:"imagetotext", img:"<url|base64>", module?:"common", casesensitive?:false, colors?:"rgb(..),rgb(..)" }` ? `{ success, message, captcha:"<ch?>" }`.
  - *getcode:* `{ key, type:"getcode", img:"<base64>" }` ? `{ success, captcha:"code1,code2,.." }`.
- `key` l?u secret, kh�ng l? frontend.
- *L?u �:* doc ngu?n ???c **c�o** t? Postman ? c� th? thi?u endpoint kh�c (vd reCAPTCHA) � ki?m tra l?i trang ch? autocaptcha.pro n?u c?n.
