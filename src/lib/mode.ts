// 精简版(--mode lite)打包成单个 management.html,由 CPA 自己提供,直接调用管理接口,不记录用量
export const LITE = import.meta.env.MODE === "lite";
