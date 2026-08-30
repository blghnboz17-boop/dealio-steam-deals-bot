export type HtmlPageOptions = {
  readonly title: string;
  readonly body: string;
  readonly bodyClass: 'login-page' | 'dashboard-page';
  readonly refresh?: { readonly seconds: 2; readonly url: '/admin' };
};

export type PostFormOptions = {
  readonly action: string;
  readonly csrfToken: string;
  readonly label: string;
  readonly className: 'button button--accent' | 'button button--quiet' | 'button button--critical';
  readonly field?: { readonly name: string; readonly value: string };
  readonly disabled?: boolean;
  readonly busy?: boolean;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function csrfInput(token: string): string {
  return `<input type="hidden" name="csrfToken" value="${escapeHtml(token)}">`;
}

export function postForm(options: PostFormOptions): string {
  const field = options.field === undefined
    ? ''
    : `<input type="hidden" name="${escapeHtml(options.field.name)}" value="${escapeHtml(options.field.value)}">`;
  const disabled = options.disabled === true ? ' disabled' : '';
  const busy = options.busy === true ? ' aria-busy="true"' : '';
  return `<form method="post" action="${escapeHtml(options.action)}" class="control-form">${csrfInput(options.csrfToken)}${field}<button type="submit" class="${options.className}"${disabled}${busy}>${escapeHtml(options.label)}</button></form>`;
}

export function htmlPage(options: HtmlPageOptions): string {
  const title = escapeHtml(options.title);
  const refresh = options.refresh === undefined
    ? ''
    : `\n  <meta http-equiv="refresh" content="${options.refresh.seconds};url=${options.refresh.url}">`;
  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">${refresh}
  <meta name="description" content="Dealio yerel yönetim paneli">
  <title>${title}</title>
  <link rel="stylesheet" href="/admin/styles.css">
</head>
<body class="${options.bodyClass}">${options.body}</body>
</html>`;
}
