//@ts-ignore

// shared by both the XHR and fetch hooks below
const RequestRegex =
	/^https?:\/\/(?:\w+\.)?(?:twitter|x)\.com\/[\w\/\.\-\_\=]+\/(HomeLatestTimeline|HomeTimeline|Followers|Following|SearchTimeline|UserTweets|Favoriters|Retweeters|UserCreatorSubscriptions|FollowersYouKnow|BlueVerifiedFollowers|UserByScreenName|timeline\/home\.json|TweetDetail|ModeratedTimeline|recommendations\.json|search\/typeahead\.json|search\/adaptive\.json|blocks\/destroy\.json|mutes\/users\/destroy\.json)(?:$|\?)/;

function dispatchBlueBlockerEvent(detail: BlueBlockerEvent) {
	const event = new CustomEvent('blue-blocker-event', { detail });
	/** @ts-ignore Firefox exposes this on window; everyone else uses the document event */
	if (window?.blueBlockerRequest) {
		/** @ts-ignore */
		blueBlockerRequest(event);
	} else {
		document.dispatchEvent(event);
	}
}

(function (xhr) {
	let XHR = <BlueBlockerXLMRequest>XMLHttpRequest.prototype;
	let open = XHR.open;
	let send = XHR.send;
	let setRequestHeader = XHR.setRequestHeader;
	XHR.open = function (method, url) {
		this._method = method;
		this._url = url.toString();
		this._requestHeaders = {};
		this._startTime = new Date().toISOString();
		// TODO: remove this ignore
		//@ts-ignore
		return open.apply(this, arguments);
	};
	XHR.setRequestHeader = function (header, value) {
		this._requestHeaders[header] = value;
		// TODO: remove this ignore
		//@ts-ignore
		return setRequestHeader.apply(this, arguments);
	};
	XHR.send = function (postData) {
		this.addEventListener('load', () => {
			// determine if request is a timeline/tweet-returning request
			const parsedUrl = RequestRegex.exec(this._url);
			if (this._url && parsedUrl && parsedUrl.length > 0) {
				dispatchBlueBlockerEvent({
					parsedUrl,
					url: this._url,
					body: this.response,
					request: { headers: this._requestHeaders },
					status: this.status,
				});
			}
		});
		// TODO: remove this ignore
		//@ts-ignore
		return send.apply(this, arguments);
	};
})(XMLHttpRequest);

// x.com migrated much of its API traffic from XMLHttpRequest to fetch(). The XHR
// hook above never sees those requests, which silently breaks both parsing (no
// accounts queued) and header capture (block/unblock 401s, queue stalls). Mirror
// the hook for fetch: same RequestRegex, same event. Additive — traffic still on
// XHR (tweetdeck, OldTwitter) keeps working.
(function () {
	const origFetch = window.fetch;
	if (!origFetch) return;

	function headersToObject(headers: HeadersInit | undefined): { [k: string]: string } {
		const out: { [k: string]: string } = {};
		if (!headers) return out;
		if (headers instanceof Headers) {
			headers.forEach((value, key) => (out[key] = value));
		} else if (Array.isArray(headers)) {
			for (const [key, value] of headers) out[key] = value;
		} else {
			for (const key of Object.keys(headers)) out[key] = (headers as Record<string, string>)[key];
		}
		return out;
	}

	window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		const promise = origFetch.apply(this, arguments as any);
		try {
			const url =
				typeof input === 'string'
					? input
					: input instanceof Request
						? input.url
						: input.toString();
			const parsedUrl = RequestRegex.exec(url);
			if (url && parsedUrl && parsedUrl.length > 0) {
				// x.com sets auth/csrf headers on the Request object and/or the init arg
				let headers: { [k: string]: string } = {};
				if (input instanceof Request) headers = { ...headers, ...headersToObject(input.headers) };
				if (init?.headers) headers = { ...headers, ...headersToObject(init.headers) };

				promise
					.then(response =>
						response
							.clone() // never consume the body the page is waiting on
							.text()
							.then(body =>
								dispatchBlueBlockerEvent({
									parsedUrl,
									url,
									body: body as XMLHttpRequest['response'],
									request: { headers },
									status: response.status,
								}),
							),
					)
					.catch(() => {}); // our hook must never break the page's own fetch
			}
		} catch {
			// swallow: interception must never take down x.com's requests
		}
		return promise;
	};
})();
