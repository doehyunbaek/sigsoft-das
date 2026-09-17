// Loaded as a classic script by HotCRP's $Opt["scripts"].
(() => {
  const start = () => {
    if (!document.querySelector('.das-checker-mount')) return;
    // Avoid cacheable.php / asset-CDN loader URLs; modules stay on HotCRP's origin.
    const base = new URL('scripts/das-checker/', new URL(window.siteinfo.base, location.href));
    import(new URL('integration.js', base).href).then(module => module.mount()).catch(error => {
      for (const element of document.querySelectorAll('.das-checker-mount')) {
        element.textContent = `DAS checker could not load: ${error.message}`;
      }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
