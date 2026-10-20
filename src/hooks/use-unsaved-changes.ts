import { useBeforeUnload, useBlocker } from "react-router";

/** 拦截站内路由切换与浏览器刷新/关闭,避免未保存的配置草稿静默丢失 */
export function useUnsavedChanges(dirty: boolean) {
  const blocker = useBlocker(dirty);
  useBeforeUnload((event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
  return blocker;
}
