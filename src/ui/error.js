    const ERROR_DETAILS = {
      ERR_INTERNET_DISCONNECTED: {
        title: 'No Internet Connection',
        reason: 'Your device appears to be offline. Connect to a network and try loading this page again.',
        tips: [
          'Check your Wi-Fi, Ethernet cable, or mobile hotspot connection.',
          'Verify that Airplane Mode is turned off.',
          'Restart your router or reconnect to your network.'
        ]
      },
      ERR_NAME_NOT_RESOLVED: {
        title: 'Host Not Found',
        reason: 'The server address could not be resolved via DNS.',
        tips: [
          'Check the web address for typos or extra characters.',
          'Verify your internet connection and DNS settings.',
          'The domain may no longer exist or may be temporarily unreachable.'
        ]
      },
      ERR_NAME_RESOLUTION_FAILED: {
        title: 'Host Not Found',
        reason: 'DNS lookup failed while trying to locate this server.',
        tips: [
          'Double-check the spelling of the domain name.',
          'Check your DNS resolver or VPN connection.',
          'Retry in a few moments.'
        ]
      },
      ERR_CONNECTION_REFUSED: {
        title: 'Connection Refused',
        reason: 'The server actively refused the connection.',
        tips: [
          'Confirm the server or local service is running on the requested port.',
          'Check firewall rules or proxy settings that may be blocking access.',
          'Try reloading if the service was restarting.'
        ]
      },
      ERR_CONNECTION_TIMED_OUT: {
        title: 'Connection Timed Out',
        reason: 'The server took too long to respond to your request.',
        tips: [
          'The site may be temporarily overloaded or offline.',
          'Check your internet connection, VPN, or firewall settings.',
          'Wait a moment and click Retry.'
        ]
      },
      ERR_TIMED_OUT: {
        title: 'Connection Timed Out',
        reason: 'The request timed out before the server responded.',
        tips: [
          'Check your network connection and retry.',
          'The remote server may be slow or unreachable right now.'
        ]
      },
      ERR_CONNECTION_RESET: {
        title: 'Connection Reset',
        reason: 'The connection was unexpectedly reset while transferring data.',
        tips: [
          'Retry loading the page — transient network drops often recover immediately.',
          'Check if a firewall, VPN, or proxy interrupted the connection.'
        ]
      },
      ERR_CONNECTION_CLOSED: {
        title: 'Connection Closed',
        reason: 'The server closed the connection before completing the response.',
        tips: [
          'Click Retry to send a fresh request.',
          'If this is a local or private server, inspect the server logs for errors.'
        ]
      },
      ERR_CONNECTION_ABORTED: {
        title: 'Connection Aborted',
        reason: 'The network connection was aborted before the page finished loading.',
        tips: [
          'Check your network stability and click Retry.',
          'Verify that security software or a proxy is not terminating the connection.'
        ]
      },
      ERR_CONNECTION_FAILED: {
        title: 'Connection Failed',
        reason: 'A connection to the server could not be established.',
        tips: [
          'Check your network connection and proxy settings.',
          'Try reloading the page in a few moments.'
        ]
      },
      ERR_ADDRESS_UNREACHABLE: {
        title: 'Address Unreachable',
        reason: 'The destination host could not be reached from your current network.',
        tips: [
          'Check your internet connection, local network, or VPN routing.',
          'Verify the IP address or hostname is correct.'
        ]
      },
      ERR_ADDRESS_INVALID: {
        title: 'Invalid Address',
        reason: 'The requested network address is invalid.',
        tips: [
          'Check the URL in the address bar for formatting errors.'
        ]
      },
      ERR_PROXY_CONNECTION_FAILED: {
        title: 'Proxy Connection Failed',
        reason: 'nextGx Browser could not connect to the configured proxy server.',
        tips: [
          'Check your system proxy settings and ensure the proxy is running.',
          'Retry once the proxy server is available.'
        ]
      },
      ERR_TUNNEL_CONNECTION_FAILED: {
        title: 'Tunnel Connection Failed',
        reason: 'Could not establish a secure tunnel through the proxy server.',
        tips: [
          'Verify your proxy or VPN configuration.',
          'Try disabling the proxy temporarily and retry.'
        ]
      },
      ERR_NETWORK_CHANGED: {
        title: 'Network Changed',
        reason: 'Your network connection changed while this page was loading.',
        tips: [
          'Click Retry to reload the page on your current network.'
        ]
      },
      ERR_NETWORK_ACCESS_DENIED: {
        title: 'Network Access Denied',
        reason: 'Access to the network was blocked by your firewall or system security policy.',
        tips: [
          'Check firewall or antivirus permissions for nextGx Browser.',
          'Retry once network access is allowed.'
        ]
      },
      ERR_EMPTY_RESPONSE: {
        title: 'Empty Response',
        reason: 'The server closed the connection without sending any data.',
        tips: [
          'Click Retry — the server may have encountered a temporary hiccup.',
          'Check if the site is experiencing an outage.'
        ]
      },
      ERR_CONTENT_LENGTH_MISMATCH: {
        title: 'Incomplete Response',
        reason: 'The server returned a truncated response that did not match its declared size.',
        tips: [
          'Click Retry to request the page again.',
          'The site or an upstream proxy may have cut off the response early.'
        ]
      },
      ERR_INCOMPLETE_CHUNKED_ENCODING: {
        title: 'Incomplete Response',
        reason: 'The server ended the response stream prematurely before finishing the page.',
        tips: [
          'Click Retry to reload the page.',
          'The server or proxy may have failed mid-response.'
        ]
      },
      ERR_INVALID_CHUNKED_ENCODING: {
        title: 'Invalid Server Response',
        reason: 'The server sent a malformed chunked HTTP response.',
        tips: [
          'Click Retry to request the page again.'
        ]
      },
      ERR_INVALID_RESPONSE: {
        title: 'Invalid Server Response',
        reason: 'The server returned a response that could not be understood.',
        tips: [
          'Click Retry to try loading the page again.',
          'Verify the server is serving valid HTTP/HTTPS traffic.'
        ]
      },
      ERR_HTTP_RESPONSE_CODE_FAILURE: {
        title: 'Server Returned an Error',
        reason: 'The server rejected the request with an HTTP error status and no displayable page.',
        tips: [
          'Verify you have permission to access this address.',
          'Check the URL path and click Retry if the issue may be temporary.'
        ]
      },
      ERR_TOO_MANY_REDIRECTS: {
        title: 'Too Many Redirects',
        reason: 'This page redirected too many times and could not finish loading.',
        tips: [
          'Try clearing cookies for this site in nextGx Settings.',
          'Retry once the server redirect loop is resolved.'
        ]
      },
      ERR_UNSAFE_PORT: {
        title: 'Unsafe Port Blocked',
        reason: 'This address uses a restricted network port that Chromium blocks for security reasons.',
        tips: [
          'Use a standard web port (such as 80, 443, or an application port above 1023).',
          'Check the port number in the address bar for typos.'
        ]
      },
      ERR_BLOCKED_BY_RESPONSE: {
        title: 'Blocked by Site Policy',
        reason: 'The server sent a security header that prevented this page from loading here.',
        tips: [
          'Verify the URL and try opening the site directly.'
        ]
      },
      ERR_SSL_PROTOCOL_ERROR: {
        title: 'SSL Protocol Error',
        reason: 'A secure HTTPS connection could not be negotiated with the server.',
        tips: [
          'Make sure the server supports HTTPS on this address and port.',
          'Check your system date and time, or try again later.'
        ]
      },
      ERR_SSL_VERSION_OR_CIPHER_MISMATCH: {
        title: 'Unsupported Security Protocol',
        reason: 'The server uses an outdated or incompatible TLS version or cipher suite.',
        tips: [
          'The website administrator needs to update the server TLS configuration.'
        ]
      },
      ERR_CONTENT_DECODING_FAILED: {
        title: 'Content Decoding Failed',
        reason: 'The compressed response from the server could not be decoded.',
        tips: [
          'Click Retry to request an uncorrupted response.'
        ]
      },
      ERR_FILE_NOT_FOUND: {
        title: 'File Not Found',
        reason: 'The requested local file could not be found. It may have been moved or deleted.',
        tips: [
          'Verify the file path in the address bar still exists.'
        ]
      },
      ERR_ACCESS_DENIED: {
        title: 'Access Denied',
        reason: 'Permission to access the requested resource was denied.',
        tips: [
          'Check file or network permissions and try again.'
        ]
      },
      ERR_BLOCKED_BY_CLIENT: {
        title: 'Request Blocked',
        reason: 'This page load was blocked by a browser rule or extension.',
        tips: [
          'Check your Privacy Shield or installed extensions, then click Retry.'
        ]
      },
      ERR_INVALID_URL: {
        title: 'Invalid URL',
        reason: 'The web address is malformed and cannot be loaded.',
        tips: [
          'Check the address bar for syntax mistakes.'
        ]
      },
      ERR_UNKNOWN_URL_SCHEME: {
        title: 'Unsupported Address Scheme',
        reason: 'nextGx Browser does not recognize the protocol used by this address.',
        tips: [
          'Check that the address begins with http:// or https://.'
        ]
      },
      ERR_DISALLOWED_URL_SCHEME: {
        title: 'Unsupported Address Scheme',
        reason: 'This address protocol is not allowed to load here.',
        tips: [
          'Use a standard http:// or https:// address instead.'
        ]
      }
    };

    const CODE_TO_DESC = {
      '-2': 'ERR_FAILED',
      '-6': 'ERR_FILE_NOT_FOUND',
      '-7': 'ERR_TIMED_OUT',
      '-10': 'ERR_ACCESS_DENIED',
      '-20': 'ERR_BLOCKED_BY_CLIENT',
      '-21': 'ERR_NETWORK_CHANGED',
      '-27': 'ERR_BLOCKED_BY_RESPONSE',
      '-100': 'ERR_CONNECTION_CLOSED',
      '-101': 'ERR_CONNECTION_RESET',
      '-102': 'ERR_CONNECTION_REFUSED',
      '-103': 'ERR_CONNECTION_ABORTED',
      '-104': 'ERR_CONNECTION_FAILED',
      '-105': 'ERR_NAME_NOT_RESOLVED',
      '-106': 'ERR_INTERNET_DISCONNECTED',
      '-107': 'ERR_SSL_PROTOCOL_ERROR',
      '-108': 'ERR_ADDRESS_INVALID',
      '-109': 'ERR_ADDRESS_UNREACHABLE',
      '-111': 'ERR_TUNNEL_CONNECTION_FAILED',
      '-113': 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH',
      '-118': 'ERR_CONNECTION_TIMED_OUT',
      '-130': 'ERR_PROXY_CONNECTION_FAILED',
      '-137': 'ERR_NAME_RESOLUTION_FAILED',
      '-138': 'ERR_NETWORK_ACCESS_DENIED',
      '-300': 'ERR_INVALID_URL',
      '-301': 'ERR_DISALLOWED_URL_SCHEME',
      '-302': 'ERR_UNKNOWN_URL_SCHEME',
      '-310': 'ERR_TOO_MANY_REDIRECTS',
      '-312': 'ERR_UNSAFE_PORT',
      '-320': 'ERR_INVALID_RESPONSE',
      '-321': 'ERR_INVALID_CHUNKED_ENCODING',
      '-324': 'ERR_EMPTY_RESPONSE',
      '-330': 'ERR_CONTENT_DECODING_FAILED',
      '-354': 'ERR_CONTENT_LENGTH_MISMATCH',
      '-355': 'ERR_INCOMPLETE_CHUNKED_ENCODING',
      '-379': 'ERR_HTTP_RESPONSE_CODE_FAILURE'
    };

    function formatFallbackTitle(desc) {
      if (!desc) return 'Unable to Load Page';
      const cleaned = String(desc)
        .replace(/^ERR_/i, '')
        .replace(/_/g, ' ')
        .trim()
        .toLowerCase();
      if (!cleaned) return 'Unable to Load Page';
      return cleaned.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
    }

    function resolveErrorPresentation(codeStr, rawDesc) {
      const normalizedDesc = (rawDesc || CODE_TO_DESC[String(codeStr)] || '').trim().toUpperCase();
      if (normalizedDesc && ERROR_DETAILS[normalizedDesc]) {
        return {
          codeLabel: normalizedDesc,
          ...ERROR_DETAILS[normalizedDesc]
        };
      }
      if (normalizedDesc.startsWith('ERR_CERT_') || (Number(codeStr) <= -200 && Number(codeStr) >= -219)) {
        return {
          codeLabel: normalizedDesc || `ERR_CERT (${codeStr})`,
          title: 'Connection Not Private',
          reason: 'The site presented a security certificate that could not be trusted or verified.',
          tips: [
            'Check that your system clock and date are accurate.',
            'Avoid entering sensitive information if you do not trust this network or certificate.'
          ]
        };
      }
      const label = normalizedDesc || (codeStr ? `ERROR ${codeStr}` : 'ERR_FAILED');
      return {
        codeLabel: label,
        title: formatFallbackTitle(normalizedDesc) || 'Unable to Load Page',
        reason: `The page failed to load (${label}${codeStr ? `, code ${codeStr}` : ''}).`,
        tips: [
          'Check your internet connection and verify the address in the URL bar.',
          'Click Retry to attempt loading the page again.'
        ]
      };
    }

    function extractHost(urlStr) {
      try {
        const u = new URL(urlStr);
        return u.host || '';
      } catch (_) {
        return '';
      }
    }

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme || 'gx-violet');
    }

    const params = new URLSearchParams(window.location.search);
    const failedUrl = params.get('url') || '';
    const errorCode = params.get('code') || '';
    const errorDesc = params.get('desc') || '';
    const initialTheme = params.get('theme');

    if (params.get('incognito') === '1') {
      document.documentElement.setAttribute('data-incognito', 'true');
    }
    if (initialTheme) {
      applyTheme(initialTheme);
    }

    if (window.gxErrorPageAPI?.getSettings) {
      window.gxErrorPageAPI.getSettings().then((s) => applyTheme(s?.theme)).catch(() => {});
    }
    if (window.gxErrorPageAPI?.onSettingsUpdate) {
      window.gxErrorPageAPI.onSettingsUpdate((s) => {
        if (s && s.theme) applyTheme(s.theme);
      });
    }

    const presentation = resolveErrorPresentation(errorCode, errorDesc);
    const host = extractHost(failedUrl);

    document.title = host ? `${host} — Failed to load` : 'Failed to load';
    document.getElementById('errorTitle').textContent = presentation.title;
    document.getElementById('errorCodeBadge').textContent = presentation.codeLabel;
    document.getElementById('errorReason').textContent = host
      ? `${host}: ${presentation.reason}`
      : presentation.reason;
    document.getElementById('failedUrlText').textContent = failedUrl || '(unknown address)';

    const tipsList = document.getElementById('errorTipsList');
    tipsList.innerHTML = '';
    for (const tip of presentation.tips) {
      const li = document.createElement('li');
      li.textContent = tip;
      tipsList.appendChild(li);
    }

    const btnRetry = document.getElementById('btnRetry');
    const btnRetryLabel = document.getElementById('btnRetryLabel');
    const btnBack = document.getElementById('btnBack');
    const btnHome = document.getElementById('btnHome');
    const btnProceed = document.getElementById('btnProceed');
    const proceedWarning = document.getElementById('proceedWarning');

    // "Proceed anyway" is offered ONLY for certificate errors, and only
    // as a two-step confirm: first click reveals the warning, second
    // click proceeds. The exception is session-only (see
    // src/main/cert-exceptions.js) and covers just this site's origin.
    const isCertError =
      (presentation.codeLabel || '').startsWith('ERR_CERT_') ||
      (Number(errorCode) <= -200 && Number(errorCode) >= -219);
    if (isCertError && failedUrl) {
      btnProceed.classList.remove('hidden');
    }
    let proceedArmed = false;
    let proceedStallTimer = null;
    const proceedStatus = document.getElementById('proceedStatus');
    function showProceedStatus(text, isError) {
      if (!proceedStatus) return;
      proceedStatus.textContent = text;
      proceedStatus.classList.toggle('error', Boolean(isError));
      proceedStatus.classList.remove('hidden');
    }
    function resetProceedButton() {
      clearTimeout(proceedStallTimer);
      proceedStallTimer = null;
      btnProceed.disabled = false;
      btnProceed.textContent = 'Proceed anyway — I understand the risk';
    }
    btnProceed.addEventListener('click', () => {
      if (!failedUrl || btnProceed.disabled) return;
      if (!proceedArmed) {
        proceedArmed = true;
        proceedWarning.classList.remove('hidden');
        btnProceed.textContent = 'Proceed anyway — I understand the risk';
        return;
      }
      btnProceed.disabled = true;
      btnProceed.textContent = 'Proceeding...';
      // Market audit bug #37: after Proceed the page used to sit with a
      // disabled button and no feedback (read as blank / dead) if the
      // reload stalled. Show progress, and if this page is still here
      // after 6 s, re-arm the button with an explanation instead of
      // leaving it frozen. The cert-exception logic itself is untouched
      // (src/main/cert-exceptions.js); this is only the page's feedback.
      showProceedStatus(
        host
          ? `Loading ${host} — trusting this certificate for this session only…`
          : 'Loading the site — trusting this certificate for this session only…'
      );
      clearTimeout(proceedStallTimer);
      proceedStallTimer = setTimeout(() => {
        proceedStallTimer = null;
        resetProceedButton();
        showProceedStatus(
          'Still loading — the site has not appeared yet. Click Proceed again, or Retry.',
          true
        );
      }, 6000);
      if (window.gxErrorPageAPI?.proceedAnyway) {
        Promise.resolve(window.gxErrorPageAPI.proceedAnyway(failedUrl)).catch(() => {
          resetProceedButton();
          showProceedStatus('Proceed failed — the site could not be reloaded. Check the address and try Retry.', true);
        });
      } else if (/^https:\/\//i.test(failedUrl)) {
        window.location.href = failedUrl;
      } else {
        resetProceedButton();
      }
    });

    if (!failedUrl) {
      btnRetry.classList.add('hidden');
    }

    if (window.history.length > 1) {
      btnBack.classList.remove('hidden');
    }

    let retryResetTimer = null;
    btnRetry.addEventListener('click', () => {
      if (!failedUrl || btnRetry.disabled) return;
      btnRetry.disabled = true;
      btnRetryLabel.textContent = 'Retrying...';
      clearTimeout(retryResetTimer);
      retryResetTimer = setTimeout(() => {
        btnRetry.disabled = false;
        btnRetryLabel.textContent = 'Retry';
      }, 4000);
      if (window.gxErrorPageAPI?.retry) {
        window.gxErrorPageAPI.retry(failedUrl);
      } else if (/^https?:\/\//i.test(failedUrl)) {
        window.location.href = failedUrl;
      }
    });

    window.addEventListener('pagehide', () => {
      clearTimeout(retryResetTimer);
      clearTimeout(proceedStallTimer);
    });

    btnBack.addEventListener('click', () => {
      if (window.gxErrorPageAPI?.goBack) {
        window.gxErrorPageAPI.goBack();
      } else {
        window.history.back();
      }
    });

    btnHome.addEventListener('click', () => {
      if (window.gxErrorPageAPI?.goHome) {
        window.gxErrorPageAPI.goHome();
      }
    });
  
