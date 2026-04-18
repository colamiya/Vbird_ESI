/**
 * Vbird ESI — ID 生成工具
 * 前端生成唯一 ID（避免 Rust 端产生依赖）
 */

/** 生成 UUID v4（简化版，浏览器环境够用） */
export function generateId(): string {
  return crypto.randomUUID()
}

/** 获取当前 ISO 时间字符串 */
export function nowISO(): string {
  return new Date().toISOString()
}
