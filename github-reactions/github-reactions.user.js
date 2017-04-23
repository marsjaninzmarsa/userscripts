// ==UserScript==
// @name         GitHub Reactions on lists
// @namespace    http://niewiarowski.it/
// @version      0.2.0
// @author       marsjaninzmarsa
// @description  Delivers shiny emoji reactions to issues and pull requests right to listings!
// @copyright    2017+, Kuba Niewiarowski (niewiarowski.it)
// @license      GPL3+, https://github.com/marsjaninzmarsa/userscripts/blob/master/LICENSE
// @updateURL    https://openuserjs.org/meta/marsjaninzmarsa/GitHub_Reactions_on_lists.meta.js
// @downloadURL  https://openuserjs.org/src/scripts/marsjaninzmarsa/GitHub_Reactions_on_lists.user.js
// @homepageURL  https://github.com/marsjaninzmarsa/userscripts/
// @supportURL   https://github.com/marsjaninzmarsa/userscripts/issues
// @match        https://github.com/*
// @grant        GM_log
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @domain       api.github.com
// @require      https://openuserjs.org/src/libs/Aaesos/jQuery.js
// @require      https://openuserjs.org/src/libs/cuzi/RequestQueue.js
// @require      https://openuserjs.org/src/libs/marsjaninzmarsa/webtoolkit.base64.min.js
// @compatible   Firefox with GreaseMonkey (probably, not tested yet)
// @compatible   Chrome with Tempermonkey
// @compatible   Opera with ViolentMonkey
// ==/UserScript==
// ==OpenUserJS==
// @author marsjaninzmarsa
// ==/OpenUserJS==

(function($) {
	var rq = new RequestQueue(10);
	var uuid = GM_info.uuid || GM_info.script.uuid || GM_getValue('uuid') || GM_setValue('uuid', $.now()) || GM_getValue('uuid');

	function process() {
		switch(checkMatchers()) {
			case "list":
				processIssues();
			break;
			case "tokens":
				processTokens();
			break;
		}
	}

	function checkMatchers() {
		if([
			/.+\/.+\/issues\/\d+/i,
			/.+\/.+\/pulls\/\d+/i,
		].some(function(regexp) {
			return regexp.test(window.location.pathname);
		})) {
			GM_log('Matchers: false');
			return false;
		}

		if([
			/.+\/.+\/issues/i,
			/.+\/.+\/pulls/i,
		].some(function(regexp) {
			return regexp.test(window.location.pathname);
		})) {
			GM_log('Matchers: list');
			return "list";
		}

		if([
			/settings\/tokens/i,
		].some(function(regexp) {
			return regexp.test(window.location.pathname);
		})) {
			GM_log('Matchers: tokens');
			return "tokens";
		}
	}

	function processIssues() {
		$('.issues-listing .js-issue-row').each(function() {
			processIssue(this);
		});
	}

	function processIssue(issue) {
		id = $(issue).data('id');
		cached = getDataFromCache(id);

		if(!rq.hasReachedTotal()) {
			headers = {
				"Accept": "application/vnd.github.squirrel-girl-preview",
			};
			if(cached.etag && !$.isEmptyObject(cached.reactions)) {
				headers["If-None-Match"] = cached.etag;
			} else if(cached.modified) {
				headers["If-Modified-Since"] = cached.modified;
			}
			if(token = GM_getValue('token')) {
				headers["Authorization"] = "Basic "+Base64.encode(token);
			}
			rq.add({
			// GM_log({
				method:  "GET",
				url:     "https://api.github.com/repos" + $(issue).find('a.js-navigation-open').attr('href') + "/reactions",
				responseType: "json",
				context: issue,
				headers: headers,
				onload: function(response) {
					response.headers = parseResponseHeaders(response.responseHeaders);
					reactions = processResponse(response);
					showReactions(response.context, reactions);
				}
			});
		} else {
			showReactions(issue, cached.reactions);
		}
	}

	function getDataFromCache(id) {
		return JSON.parse(
			window.sessionStorage.getItem('githubReactionsUserJs-'+id)
		) || {etag: null, modified: null, reactions: {}};
	}

	function putDataToCache(id, etag, reactions, modified) {
		window.sessionStorage.setItem('githubReactionsUserJs-'+id,
			JSON.stringify(
				{etag: etag, modified: modified, reactions: reactions}
			)
		);
	}

	function processResponse(response) {
		id = $(response.context).data('id');
		cached = getDataFromCache(id);

		// GM_log(response);
		switch(response.status) {
			case 304:
			return cached.reactions;
			case 401:
				processQuotaExceeded(response);
			break;
			case 403:
				if(response.headers['x-ratelimit-remaining'] == 0) {
					processQuotaExceeded(response);
				}
			return cached.reactions;
			case 200:
				var reactions = {};
				if(response.response.length) {
					response.response.forEach(function(reaction) {
						reactions[reaction.content] = reactions[reaction.content] || [];
						reactions[reaction.content].push(reaction.user.login);
					});
				}
				putDataToCache(id, response.headers.ETag, reactions, response.headers['last-modified'] || null);
			return reactions;
			default:
				GM_log(response);
			break;
		}
	}

	function processQuotaExceeded(response) {
		// Abort request and prevent future ones
		rq.abort();
		rq.maxParallel = 0;

		// Explain situation
		notification = {
			title: "API rate limit exceeded",
			text:  [
				"Quota will reset "+new Date(response.headers['x-ratelimit-reset'] * 1000).toLocaleTimeString()+".",
				"You can intercrease limit by providing personal access token."
			],
			prompt: "Authorize",
			highlight: true,
			timeout: 0,
			onclick: openAccessTokenPage
		};
		if(response.status == 401) {
			notification = $.extend(notification, {
				title: "Invalid access token",
				text: [
					"Access token is invalid and will be reseted.",
					"You can generate new token and reauthorize."
				],
				prompt: "Reauthorize"
			});
			GM_setValue('token', null);
		}
		showNotification(notification, response.headers['x-ratelimit-reset']);
		showMessage(notification);

		// Wait until quota reset and revert
		setTimeout(function() {
			processQuotaRenewed();
		}, response.headers['x-ratelimit-reset'] * 1000 - $.now());

		// Maybe token added?
		if(typeof GM_addValueChangeListener === 'function') {
			GM_addValueChangeListener('token', function() {
				processQuotaRenewed();
			});
		}
		var old_value = GM_getValue('token');
		var interval  = setInterval(function() {
			if(GM_getValue('token') != old_value) {
				processQuotaRenewed();
				clearInterval(interval);
			}
		}, 10000);
	}

	function processQuotaRenewed() {
		rq.maxParallel = 10;
		showMessage(null);
	}

	// From https://jsperf.com/parse-response-headers-from-xhr/3
	function parseResponseHeaders(headerStr) {
		var l = headerStr.length,
		p = -2,
		j = 0,
		headers = {},
		l, i, q, k, v;

		while ( (p = headerStr.indexOf( "\r\n", (i = p + 2) + 5 )) > i )
			(q = headerStr.indexOf( ":", i + 3 )) > i && q < p
			&& (headers[k = headerStr.slice( i, q ).toLowerCase()] = headerStr.slice( q + 2, p ))[0] === '"'
			&& (headers[k] = JSON.parse( headers[k] ));
			(q = headerStr.indexOf( ":", i + 3 )) > i && q < l
			&& (headers[k = headerStr.slice( i, q ).toLowerCase()] = headerStr.slice( q + 2 ))[0] === '"'
			&& (headers[k] = JSON.parse( headers[k] ))
		return headers;
	}

	var tags = [];
	function showNotification(notification, tag) {
		if(typeof notification === 'string') {
			notification = {
				text: notification
			};
		}
		if(typeof notification.text === 'object' && notification.text.length) {
			notification.text = notification.text.join("\n");
		}
		notification.title = notification.title || GM_info.script.name;

		if(typeof GM_notification === 'function') {
			if(tags.indexOf(tag) != -1) {
				return;
			}
			GM_notification(notification);
			if(tag) {
				tags.push(tag);
			}
		} else if ("Notification" in window) {
			if(Notification.permission === "granted") {
				var n = new Notification(notification.title, {
					body: notification.text,
					tag: tag,
				});
				if(notification.timeout !== 0) {
					setTimeout(n.close.bind(n), notification.timeout || 5000);
				}
				n.addEventListener('click', notification.onclick);
			} else {
				Notification.requestPermission(function (permission) {
					showNotification(notification, tag);
				});
			}
		} else {
			if(tags.indexOf(tag) != -1) {
				return;
			}
			alertText = [notification.title, notification.text].join("\n");
			if("onclick" in notification) {
				if(confirm(alertText)) {
					notification.onclick();
				}
			} else {
				alert(alertText);
			}
			if(tag) {
				tags.push(tag);
			}
		}
	}

	function showMessage(message) {
		if(typeof message === 'string') {
			message = {
				text: message
			};
		}
		if(typeof message.text === 'object' && message.text.length) {
			message.text = message.text.join("</span><br /><span>");
		}

		$('#github-reactions-message').detach();
		if(message == null) {
			return;
		}
		$('body').append('<div id="github-reactions-message"></div>');
		$('#github-reactions-message').append(
			$('#ajax-error-message > svg').clone(),
			$('#ajax-error-message > button').clone(),
			'<strong>'+(message.title || GM_info.script.name)+':</strong> <span>'+message.text+'</span>',
			"\n"
		);
		if(typeof message.onclick === "function") {
			$('#github-reactions-message').append(
				'<a href="#">' + (message.prompt || 'Proceed') + '</a>'
			);
			$('#github-reactions-message a').click(message.onclick);
		}
		$('#github-reactions-message').addClass('flash flash-warn flash-banner');
	}

	function openAccessTokenPage() {
		GM_openInTab("https://github.com/settings/tokens/new#"+uuid, {
			active: true,
			insert: true
		});
	}

	function showReactions(issue, reactions) {
		if($.isEmptyObject(reactions)) {
			return;
		}
		var container = $(issue).find('.d-table > .reactions');
		if(container.length) {
			$(container).html('');
		} else {
			$(issue).find('.d-table > .col-9').removeClass('col-9').addClass('col-7');
			container = $('<div class="float-left p-2 no-wrap text-right col-2 reactions"></div>');
			$(issue).find('.d-table > .col-2').before(container);
		}
		var emojis    = {
			"+1":       "👍",
			"-1":       "👎",
			"laugh":    "😄",
			"confused": "😕",
			"heart":    "❤",
			"hooray":   "🎉",
		};
		$.each(reactions, function(reaction, people) {
			$('<div>'+emojis[reaction]+'</div>')
			 	.addClass([
			 		'float-right',
			 		'tooltipped',
			 		'tooltipped-se',
			 		'tooltipped-multiline'
			 	].join(' '))
			 	.attr('aria-label', people.join(', ')+' reacted with '+reaction+' emoji')
			 	.append('<span class="text-small text-bold">'+people.length+'</span>')
			 	.appendTo(container);
		});
	}

	function processTokens() {
		if(window.location.hash == "#"+uuid) {
			window.sessionStorage.setItem('processingTokens', uuid);
			window.location.hash = "";
		}
		if(window.sessionStorage.getItem('processingTokens') == uuid) {
			$('#oauth_access_description').val(GM_info.script.name+' userscript in '+GM_info.scriptHandler);
			var counter = 0;
			$('.js-checkbox-scope').change(function() {
				if($(this).is(':checked')) {
					var messages = {
						0: {
							text: "We don't need any of those...",
							timeout: 0
						},
						3: "Nah, srsly, it's just simple quota extension...",
						6: "And for what, exactly?",
						9: "If you must...",
						12: "You're plaing with me, right?",
						15: "Nothing here, turn around.",
						18: "You're annoing. That's not funny.",
						21: "Don't you have anything better to do?",
						23: "I don't know, wath some movie, play a game, go outside, find girlfriend... ok, ok, back to Earth, just watch movie.",
						28: "Why you don't believe me? You have nothing to do here.",
						35: "Looking for porn or what??",
						40: "No pron here.",
						50: {
							title:   "Ok, ok, you won. Here, tits, have fun.",
							text:    "[click for tits][nsfw]",
							onclick: function() {
								GM_openInTab('http://unnamedporn.soup.io');
							},
							timeout: 0
						}
					}
					if(messages[counter]) {
						showNotification(messages[counter], 'tokenDescription-'+counter);
					}
					counter = counter+1;
				}
			});

			if($('.access-token.new-token').length) {
				function saveToken() {
					GM_setValue('token', [
						$('meta[name=user-login]').attr('content'),
						$('.access-token.new-token code.token').text()
					].join(':'));
					$('#github-reactions-save-token-button').text('✓');
					showNotification('Token saved!');
					showMessage('Token saved, you can close the window.');
				}

				showNotification({
					text: 'Token generated, save it?',
					onclick: saveToken,
				});
				$('<a href="#" id="github-reactions-save-token-button">Use token in userscript</a>')
					.addClass([
						'btn',
						'btn-sm',
						'BtnGroup-item'
					].join(' '))
					.click(function(e) {
						e.preventDefault();
						e.stopPropagation();
						saveToken();
					})
					.prependTo('.access-token.new-token .BtnGroup');
			}
		}
	}



	if(!GM_getValue('hello', false)) {
		showNotification({
			title: 'Hello!',
			text:  'You have succesfully installed GitHub Reactions UserScript. 😊'
		}, 'hello');
		GM_setValue('hello', true);
	}


	// GM_log(GM_info);

	document.addEventListener("pjax:end", function() {
		process();
	});
      
	process();

})(jQuery);