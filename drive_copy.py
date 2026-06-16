#@title ⚙️ BƯỚC 2: CHẠY LỆNH COPY (Bản Tự Động + Checkpoint + Tách file bị chặn tải)
import re
import time
import json
import io
import threading
import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload
from google.colab import files, userdata
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

class DriveAllInOne:
    def __init__(self, max_threads=10):
        self.lock = threading.Lock()
        self.max_threads = max_threads
        self.export_data = []
        self.error_data = []
        self.blocked_data = [] # CHỨA DANH SÁCH FILE BỊ CHẶN TẢI
        self.excluded_strings = []
        # === SKIP: Google Sheets + Shortcut ===
        self.skip_mime_types = {
            'application/vnd.google-apps.spreadsheet',  # Google Sheets
            'application/vnd.google-apps.shortcut'      # Shortcut (lối tắt)
        }
        self.processed_ids = set()
        self.checkpoint_file_id = None

    def get_service(self):
        try:
            token_str = userdata.get('DRIVE_TOKEN')
            if not token_str:
                raise ValueError("Không tìm thấy DRIVE_TOKEN trong tab Secrets bên trái Colab.")
            token_data = json.loads(token_str)
            creds = Credentials.from_authorized_user_info(token_data)
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            return build('drive', 'v3', credentials=creds, cache_discovery=False)
        except Exception as e:
            print(f"❌ Lỗi xác thực Token: {e}")
            raise e

    def load_checkpoint(self, service, dest_id):
        print("\n🔍 Đang kiểm tra Checkpoint cũ trên Drive...")
        q = f"'{dest_id}' in parents and name='.clone_checkpoint.json' and trashed=false"
        try:
            req = service.files().list(q=q, fields='files(id)')
            res = self._execute_with_retry(req)
            files_found = res.get('files', [])
            if files_found:
                self.checkpoint_file_id = files_found[0]['id']
                req_media = service.files().get_media(fileId=self.checkpoint_file_id)
                fh = io.BytesIO()
                downloader = MediaIoBaseDownload(fh, req_media)
                done = False
                while done is False:
                    status, done = downloader.next_chunk()

                content = fh.getvalue().decode('utf-8')
                if content:
                    self.processed_ids = set(json.loads(content))
                    print(f" 📦 ĐÃ TẢI CHECKPOINT: Tự động bỏ qua {len(self.processed_ids)} file đã copy từ các lần trước!")
            else:
                print(" 📦 Không có Checkpoint cũ. Sẽ chạy quét toàn bộ từ đầu.")
        except Exception as e:
            print(f" ⚠️ Lỗi khi tải Checkpoint (Sẽ chạy từ đầu): {e}")

    def save_checkpoint(self, service, dest_id):
        if not self.processed_ids:
            return
        print(f"\n💾 Đang lưu Checkpoint ({len(self.processed_ids)} file) vào Drive để dùng cho lần sau...")
        try:
            checkpoint_data = json.dumps(list(self.processed_ids))
            media = MediaIoBaseUpload(io.BytesIO(checkpoint_data.encode('utf-8')), mimetype='application/json', resumable=True)

            if self.checkpoint_file_id:
                req = service.files().update(fileId=self.checkpoint_file_id, media_body=media)
                self._execute_with_retry(req)
            else:
                body = {'name': '.clone_checkpoint.json', 'parents': [dest_id]}
                req = service.files().create(body=body, media_body=media, fields='id')
                res = self._execute_with_retry(req)
                self.checkpoint_file_id = res['id']
            print(" ✅ Đã lưu file Checkpoint (.clone_checkpoint.json) thành công!")
        except Exception as e:
            print(f" ⚠️ Lỗi khi lưu Checkpoint: {e}")

    def extract_ids(self, text):
        if not text: return []
        parts = re.split(r'[\n,]+', text)
        ids = []
        for part in parts:
            part = part.strip()
            if not part: continue
            found_ids = re.findall(r'[-\w]{25,}', part)
            ids.extend(found_ids)
        return list(dict.fromkeys(ids))

    def _execute_with_retry(self, request, max_retries=3):
        for attempt in range(max_retries):
            try:
                return request.execute()
            except HttpError as e:
                if e.resp.status in [403, 429, 500, 502, 503]:
                    sleep_time = (2 ** attempt) + 1
                    print(f"   ⏳ Quá tải API, đợi {sleep_time}s rồi thử lại... (Mã lỗi: {e.resp.status})")
                    time.sleep(sleep_time)
                else:
                    raise e
            except Exception as e:
                print(f"   ⚠️ Lỗi mạng, đợi 2s rồi thử lại... ({str(e)})")
                time.sleep(2)
        raise Exception("Thử lại thất bại.")

    def get_item_info(self, service, item_id):
        try:
            # ĐÃ THÊM: capabilities để check quyền copy/download ngầm
            req = service.files().get(
                fileId=item_id, fields='id,name,mimeType,size,capabilities', supportsAllDrives=True
            )
            return self._execute_with_retry(req)
        except Exception:
            return None

    def get_children(self, service, folder_id):
        files_list = []
        page_token = None
        while True:
            try:
                # ĐÃ THÊM: capabilities để quét quyền của hàng loạt file cùng lúc
                req = service.files().list(
                    q=f"'{folder_id}' in parents and trashed=false",
                    pageSize=1000,
                    fields='files(id,name,mimeType,size,capabilities),nextPageToken',
                    pageToken=page_token,
                    supportsAllDrives=True, includeItemsFromAllDrives=True
                )
                res = self._execute_with_retry(req)
                files_list.extend(res.get('files', []))
                page_token = res.get('nextPageToken')
                if not page_token: break
            except Exception:
                break
        return files_list

    def copy_file(self, service, file_id, dest_id, file_name):
        safe_name = file_name.replace("'", "\'")
        q = f"'{dest_id}' in parents and name='{safe_name}' and trashed=false"
        try:
            req_exist = service.files().list(q=q, fields='files(id,name)', supportsAllDrives=True, includeItemsFromAllDrives=True)
            exist = self._execute_with_retry(req_exist).get('files', [])

            if exist:
                return exist[0]['id']

            body = {'name': file_name, 'parents': [dest_id]}
            req_copy = service.files().copy(fileId=file_id, body=body, supportsAllDrives=True)
            res = self._execute_with_retry(req_copy)

            print(f"   ✅ Đã copy MỚI file: {file_name}")
            return res['id']
        except Exception as e:
            print(f"   ❌ LỖI COPY FILE '{file_name}': {e}")
            self._log_error(file_name, 'File', file_id, str(e))
            return None

    def create_folder(self, service, parent_id, folder_name):
        safe_name = folder_name.replace("'", "\'")
        q = f"'{parent_id}' in parents and name='{safe_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        try:
            req_exist = service.files().list(q=q, fields='files(id,name)', supportsAllDrives=True, includeItemsFromAllDrives=True)
            exist = self._execute_with_retry(req_exist).get('files', [])

            if exist:
                return exist[0]['id']

            body = {'name': folder_name, 'mimeType': 'application/vnd.google-apps.folder', 'parents': [parent_id]}
            req_create = service.files().create(body=body, fields='id', supportsAllDrives=True)
            res = self._execute_with_retry(req_create)

            print(f"   📁 Đã tạo thư mục: {folder_name}")
            return res['id']
        except Exception as e:
            self._log_error(folder_name, 'Folder', '', str(e))
            return None

    def _log_error(self, name, item_type, source_id, reason):
        with self.lock:
            self.error_data.append({
                'Tên File/Folder': name, 'Loại': item_type, 'ID Nguồn': source_id, 'Lý do lỗi': reason
            })

    def recursive_copy(self, service, src_folder_id, dest_folder_id):
        children = self.get_children(service, src_folder_id)
        for child in children:
            mime_type = child.get('mimeType', '')
            child_name = child.get('name', '')
            child_id = child.get('id', '')

            # === SKIP Google Sheets + Shortcut (ở mọi cấp con) ===
            if mime_type in self.skip_mime_types:
                print(f"   ⏭️  Bỏ qua (Sheet/Shortcut): {child_name}")
                continue
            if any(x.lower() in child_name.lower() for x in self.excluded_strings if x):
                continue

            # --- KIỂM TRA QUYỀN: NẾU BỊ CHẶN TẢI THÌ BỎ QUA ---
            can_copy = child.get('capabilities', {}).get('canCopy', True)
            if not can_copy and mime_type != 'application/vnd.google-apps.folder':
                print(f"   🚫 Bỏ qua (BỊ CHẶN TẢI/COPY): {child_name}")
                with self.lock:
                    self.blocked_data.append({
                        'Tên File': child_name,
                        'Link Gốc (Chỉ xem)': f"https://drive.google.com/open?id={child_id}"
                    })
                continue

            if mime_type == 'application/vnd.google-apps.folder':
                new_sub = self.create_folder(service, dest_folder_id, child_name)
                if new_sub: self.recursive_copy(service, child_id, new_sub)
            else:
                if child_id in self.processed_ids:
                    continue

                new_id = self.copy_file(service, child_id, dest_folder_id, child_name)
                if new_id:
                    with self.lock:
                        self.processed_ids.add(child_id)

    def process_item(self, index, item_id, root_dest_id):
        service = self.get_service()
        info = self.get_item_info(service, item_id)

        if not info:
            self._log_error(f"ID: {item_id}", 'Unknown', item_id, 'Không truy cập được')
            return

        name = info['name']
        mime_type = info.get('mimeType', '')
        print(f"\n🔄 [{index + 1}] QUÉT VÀ XỬ LÝ: {name}")

        # === SKIP Google Sheets + Shortcut (item gốc) ===
        if mime_type in self.skip_mime_types:
            print(f"   ⏭️  Bỏ qua (Sheet/Shortcut): {name}")
            return

        # --- KIỂM TRA QUYỀN FILE LẺ ---
        can_copy = info.get('capabilities', {}).get('canCopy', True)
        if not can_copy and mime_type != 'application/vnd.google-apps.folder':
            print(f"   🚫 Bỏ qua (BỊ CHẶN TẢI/COPY): {name}")
            with self.lock:
                self.blocked_data.append({
                    'Tên File': name,
                    'Link Gốc (Chỉ xem)': f"https://drive.google.com/open?id={item_id}"
                })
            return

        try:
            if mime_type == 'application/vnd.google-apps.folder':
                new_id = self.create_folder(service, root_dest_id, name)
                if not new_id: return
                self.recursive_copy(service, item_id, new_id)
                final_link = f"https://drive.google.com/drive/folders/{new_id}"
                item_type = 'Folder'
            else:
                if item_id in self.processed_ids:
                    return
                new_id = self.copy_file(service, item_id, root_dest_id, name)
                if not new_id: return
                with self.lock:
                    self.processed_ids.add(item_id)
                final_link = f"https://drive.google.com/open?id={new_id}"
                item_type = 'File'

            with self.lock:
                self.export_data.append({
                    'STT_Goc': index + 1, 'Tên File/Folder': name, 'Loại': item_type,
                    'Link Gốc': f"https://drive.google.com/open?id={item_id}", 'Link Đích (Mới)': final_link
                })
        except Exception as e:
            self._log_error(name, item_type, item_id, str(e))

    def start(self, source_text_val, dest_text_val, exclude_str_val, sort_val, excel_name_val):
        s_ids = self.extract_ids(source_text_val)
        d_ids = self.extract_ids(dest_text_val)

        if not s_ids or not d_ids:
            print("❗️ Lỗi: Cấu hình thiếu Link Nguồn hoặc Link Đích ở Bước 1.")
            return

        dest_id = d_ids[0]
        self.excluded_strings = [x.strip() for x in exclude_str_val.split(',') if x.strip()]

        main_service = self.get_service()
        self.load_checkpoint(main_service, dest_id)

        print(f"\n🚀 Bắt đầu quét {len(s_ids)} mục duy nhất...")

        futures = []
        with ThreadPoolExecutor(max_workers=self.max_threads) as executor:
            for i, sid in enumerate(s_ids):
                futures.append(executor.submit(self.process_item, i, sid, dest_id))
            for future in as_completed(futures):
                future.result()

        self.save_checkpoint(main_service, dest_id)

        # XUẤT FILE THÀNH CÔNG
        if self.export_data:
            df = pd.DataFrame(self.export_data)
            if sort_val == 'name':
                df = df.sort_values(by='Tên File/Folder').reset_index(drop=True)
            df.insert(0, 'STT_Mới', range(1, len(df) + 1))
            filename = excel_name_val.strip() or 'drive_copy_report.xlsx'
            df.to_excel(filename, index=False)
            print(f"\n✅ HOÀN THÀNH! Đã copy xong mục mới. File báo cáo: {filename}")
            files.download(filename)
        else:
            print("\n✅ HOÀN TẤT. Không có file nào mới cần copy thêm.")

        # XUẤT FILE LỖI HỆ THỐNG
        if self.error_data:
            df_err = pd.DataFrame(self.error_data)
            err_filename = 'Loi_Copy_Drive.xlsx'
            df_err.to_excel(err_filename, index=False)
            print(f"🚨 Đã tải xuống file báo lỗi hệ thống: {err_filename}")
            files.download(err_filename)

        # XUẤT FILE BỊ CHẶN TẢI (TÍNH NĂNG MỚI)
        if self.blocked_data:
            df_block = pd.DataFrame(self.blocked_data)
            block_filename = 'Danh_Sach_Bi_Chan_Tai.xlsx'
            df_block.to_excel(block_filename, index=False)
            print(f"🚫 CẢNH BÁO: Phát hiện {len(self.blocked_data)} file bị chủ sở hữu khóa nút tải! Đã xuất danh sách: {block_filename}")
            files.download(block_filename)

# --- THỰC THI CHƯƠNG TRÌNH ---
try:
    bot = DriveAllInOne(max_threads=MAX_THREADS)
    bot.start(
        source_text_val=SOURCE_LINKS,
        dest_text_val=DEST_LINK,
        exclude_str_val=EXCLUDE_STR,
        sort_val=SORT_OPTION,
        excel_name_val=EXCEL_NAME
    )
except NameError as e:
    print(f"❗️ LỖI: {e}. Vui lòng chạy Cell 1 trước để khởi tạo cấu hình!")
