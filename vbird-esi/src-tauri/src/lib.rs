// Vbird ESI — Tauri Rust 后端
// 核心文件操作命令 + 插件注册

use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// 获取应用数据目录
fn get_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    Ok(base)
}

/// 确保目录存在
fn ensure_dir(path: &PathBuf) -> Result<(), String> {
    if !path.exists() {
        fs::create_dir_all(path).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    Ok(())
}

/// 原子写入：先写 .tmp → 备份旧文件为 .bak → rename .tmp 为正式文件
/// 防止写入过程中断电/崩溃导致数据损坏
fn atomic_write(path: &str, content: &[u8]) -> Result<(), String> {
    let path_buf = PathBuf::from(path);
    if let Some(parent) = path_buf.parent() {
        ensure_dir(&parent.to_path_buf())?;
    }

    let tmp_path = format!("{}.tmp", path);
    let bak_path = format!("{}.bak", path);

    // Step 1: 写入临时文件
    fs::write(&tmp_path, content)
        .map_err(|e| format!("写入临时文件失败 {}: {}", tmp_path, e))?;

    // Step 2: 如果旧文件存在，备份为 .bak
    if path_buf.exists() {
        // 先删除旧 .bak（忽略错误，可能不存在）
        let _ = fs::remove_file(&bak_path);
        if let Err(e) = fs::rename(path, &bak_path) {
            // 备份失败 — 尝试直接删除旧文件（Windows 兼容）
            eprintln!("备份旧文件失败 {} -> {}: {}，尝试直接删除", path, bak_path, e);
            let _ = fs::remove_file(path);
        }
    }

    // Step 3: rename 临时文件为正式文件
    // Windows 上如果目标文件还存在（Step 2 删除失败），先强制移除
    if path_buf.exists() {
        fs::remove_file(path)
            .map_err(|e| format!("无法移除旧文件 {}: {}", path, e))?;
    }
    fs::rename(&tmp_path, path)
        .map_err(|e| format!("重命名失败 {} -> {}: {}", tmp_path, path, e))?;

    Ok(())
}

/// 读取 JSON 文件
#[tauri::command]
fn read_json_file(path: String) -> Result<Value, String> {
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取文件失败 {}: {}", path, e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("解析 JSON 失败 {}: {}", path, e))
}

/// 写入 JSON 文件（原子写入 + 自动备份）
#[tauri::command]
fn write_json_file(path: String, data: Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("序列化 JSON 失败: {}", e))?;
    atomic_write(&path, content.as_bytes())
}

/// 删除文件（幂等：文件已不存在时视为成功，BUG-3 修复）
#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    match fs::remove_file(&path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), // 幂等：已删除视为成功
        Err(e) => Err(format!("删除文件失败 {}: {}", path, e)),
    }
}

/// 写入二进制文件（原子写入，用于 Excel 导出等场景）
#[tauri::command]
fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    atomic_write(&path, &data)
}

/// 列出目录下所有 JSON 文件
#[tauri::command]
fn list_json_files(dir: String) -> Result<Vec<String>, String> {
    let dir_path = PathBuf::from(&dir);
    if !dir_path.exists() {
        return Ok(vec![]);
    }
    let entries = fs::read_dir(&dir_path)
        .map_err(|e| format!("读取目录失败 {}: {}", dir, e))?;

    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录条目失败: {}", e))?;
        let path = entry.path();
        // OPT-7: 大小写不敏感匹配，避免 .JSON 被漏过
        let is_json = path.extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("json"))
            .unwrap_or(false);
        if is_json {
            if let Some(name) = path.to_str() {
                files.push(name.to_string());
            }
        }
    }
    files.sort();  // P2-5: 确保跨系统列表顺序稳定
    Ok(files)
}

/// 检查文件是否存在
#[tauri::command]
fn file_exists(path: String) -> bool {
    PathBuf::from(&path).exists()
}

/// 获取数据存储根路径
#[tauri::command]
fn get_app_data_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = get_data_dir(&app)?;
    ensure_dir(&dir)?;
    dir.to_str()
        .map(|s| s.to_string())
        .ok_or("路径转换失败".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_json_file,
            write_json_file,
            delete_file,
            write_binary_file,
            list_json_files,
            file_exists,
            get_app_data_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
