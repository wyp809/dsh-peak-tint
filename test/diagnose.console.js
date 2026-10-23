/**
 * 页面内自检脚本 —— 粘贴到 DevTools Console 里执行。
 *
 * 它回答四个问题，全都只读：
 *   1. client bundle 进没进引导图（inBoot / clientRoute）
 *   2. 胶囊渲染出来没有（pillFound）
 *   3. 四个 token 现在被谁的值占据（tokens）
 *   4. 本地配置是什么（config）
 *
 * 判定表：
 *   inBoot=false                  → Host 没加载这个 bundle（未启用 / 没重启）
 *   inBoot=true, clientRoute=404  → 引导图有它但资源没构建（重启一次）
 *   inBoot=true, pillFound=false  → 视图没挂上，看 Console 里 slot entry crashed
 *   pillFound=true, tokens 仍是原值 → 染色被别的层压住（设置页会显示「被他层覆盖」）
 *   pillFound=true, tokens 是我们的值 → 一切正常
 */
(async () => {
  const id = 'dsh-peak-tint';
  const boot = window.__DSH_BOOT__ || {};
  const ids = (boot.entries || []).map((entry) => entry.id);
  const inBoot = ids.indexOf(id) >= 0;

  const pill = document.querySelector('.pt-pill');

  const read = (name) => {
    try {
      const onBody = getComputedStyle(document.body).getPropertyValue(name);
      if (onBody && onBody.trim()) return onBody.trim();
      const onRoot = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (onRoot && onRoot.trim()) || '(empty)';
    } catch (error) {
      return '(read failed)';
    }
  };

  const tokens = {};
  ['--dsw-specific-sidebar-fill', '--dsw-alias-border-l1', '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1']
    .forEach((name) => { tokens[name] = read(name); });

  let config = null;
  try {
    config = JSON.parse(window.localStorage.getItem('dsh-peak-tint/config@1') || 'null');
  } catch (error) {
    config = 'unreadable';
  }

  let clientRoute = 'n/a';
  try {
    const response = await fetch('plugins/??' + id + '/client.js');
    clientRoute = response.status;
  } catch (error) {
    clientRoute = 'fetch failed: ' + (error && error.message ? error.message : String(error));
  }

  const report = {
    inBoot,
    bootEntryCount: ids.length,
    clientRoute,
    pillFound: Boolean(pill),
    pillText: pill ? pill.textContent : null,
    config,
    tokens,
  };

  console.log('[peak-tint diagnostic]', report);
  console.table(report.tokens);
  return report;
})();
