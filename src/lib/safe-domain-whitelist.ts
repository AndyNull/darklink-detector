/**
 * Safe Domain Whitelist
 *
 * A comprehensive list of well-known safe domains that should NEVER be added
 * to the malicious library. These are major tech companies, CDN services,
 * SaaS platforms, standards bodies, social media, and other widely trusted domains.
 *
 * This whitelist is used by:
 * - Threat intelligence collectors (update/route.ts)
 * - ThreatBook auto-add (threat-intel/route.ts)
 * - Manual add/batch import (malicious/route.ts)
 * - Database cleanup scripts
 *
 * IMPORTANT: When adding new entries, use lowercase only.
 * The isSafeDomain() function normalizes input to lowercase before checking.
 */

// ─── Top-level safe domains that should NEVER appear in the malicious library ───────
// These are the root domains (e.g., "google.com" blocks "google.com" and all subdomains)

const SAFE_DOMAINS: Set<string> = new Set([
  // ── Major Tech Companies ──
  'google.com',
  // Note: googleapis.com and googleusercontent.com are in PLATFORM_DOMAINS (can host user content)
  'googlecloud.com',
  'googletagmanager.com',
  'google-analytics.com',
  'gstatic.com',
  'ggpht.com',
  'youtube.com',
  'youtu.be',
  'ytimg.com',
  'youtube-nocookie.com',
  'youtubei.googleapis.com',  // Google's own API, safe
  'android.com',
  'chrome.com',
  'chromium.org',
  'chromecast.com',
  'blogger.com',
  'blogspot.com',
  'gmail.com',
  'googlemail.com',
  'googlegroups.com',
  'googleadservices.com',
  'googlesyndication.com',
  'doubleclick.net',
  'admob.com',
  'firebase.com',
  'firebaseapp.com',
  'firebase.google.com',
  'flutter.dev',
  'dart.dev',
  'kotlinlang.org',
  'tensorflow.org',
  'deepmind.com',
  'waymo.com',

  'microsoft.com',
  'microsoftonline.com',
  'microsoftstore.com',
  'windows.com',
  'windowsupdate.com',
  'windows.net',
  'azure.com',
  'azureedge.net',
  'azurefd.net',
  'azurewebsites.net',
  'azure-mobile.net',
  'azureedge.net',
  'bing.com',
  'bing.net',
  'live.com',
  'hotmail.com',
  'outlook.com',
  'outlook.office.com',
  'office.com',
  'office365.com',
  'office.net',
  'onenote.com',
  'onenote.net',
  'sharepoint.com',
  'sharepoint.online',
  'teams.microsoft.com',
  'skype.com',
  'skype.net',
  'msn.com',
  'msedge.net',
  'msftconnecttest.com',
  'msftncsi.com',
  'visualstudio.com',
  'visualstudio.net',
  'nuget.org',
  'nugettest.org',
  'powershellgallery.com',
  'dotnet.microsoft.com',
  'dotnetfoundation.org',
  'asp.net',
  'typescriptlang.org',
  'github.io',
  'azure-devices.net',
  'azure-devices-provisioning.net',
  'xbox.com',
  'linkedin.com',
  'linkedin.net',

  'apple.com',
  'icloud.com',
  'icloud-content.com',
  'apple-cloud.com',
  'apple-mapkit.com',
  'mzstatic.com',
  'cdn-apple.com',
  'applepaycash.net',
  'itunes.com',
  'itunes.apple.com',
  'appsto.re',
  'appstore.com',
  'apps.apple.com',
  'developer.apple.com',
  'swcdn.apple.com',
  'mesu.apple.com',
  'gdmf.apple.com',

  'amazon.com',
  'amazonaws.com',
  'aws.amazon.com',
  'amazoncognito.com',
  'amazonses.com',
  'cloudfront.net',
  'cloudfront-labs.amazonaws.com',
  'elasticbeanstalk.com',
  's3.amazonaws.com',
  's3-website.amazonaws.com',
  's3-accelerate.amazonaws.com',
  's3-website-us-east-1.amazonaws.com',
  's3-website-us-west-1.amazonaws.com',
  's3-website-us-west-2.amazonaws.com',
  's3-website-eu-west-1.amazonaws.com',
  's3-website-ap-northeast-1.amazonaws.com',
  's3-website-sa-east-1.amazonaws.com',
  'aws.com',
  'awsevents.com',
  'awstrack.me',
  'amplify.aws',
  'a2z.com',

  'facebook.com',
  'fb.com',
  'fbcdn.net',
  'fbsbx.com',
  'facebook.net',
  'facebookmail.com',
  'instagram.com',
  'cdninstagram.com',
  'fb.me',
  'messenger.com',
  'meta.com',
  'metaapps.net',
  'oculus.com',
  'whatsapp.com',
  'whatsapp.net',

  // ── Major CDN & Infrastructure ──
  'cloudflare.com',
  'cloudflare-dns.com',
  'cloudflareinsights.com',
  'cloudflarestream.com',
  'cloudflareworkers.com',
  'workers.dev',
  'one.one',
  'cfargotunnel.com',
  // Note: trycloudflare.com is in PLATFORM_DOMAINS (tunnels host user content)
  'pages.dev',

  'akamai.com',
  'akamaiedge.net',
  'akamaihd.net',
  'akamai.net',
  'akamaized.net',
  'akamaitechnologies.com',
  'akamaitechnologies.fr',
  'edgesuite.net',
  'edgekey.net',
  'srip.net',
  'akamaized-staging.net',

  'fastly.com',
  'fastlylb.net',
  'fastly.net',
  'fsly.net',
  'fastly-edge.com',
  'fastly-terrarium.com',
  'dualstack.fastly.net',
  'ctrl.fastly.net',
  'map.fastly.net',
  'freetls.fastly.net',

  'cdnjs.com',
  'cloudflare.com.cdn.cloudflare.net',  // Cloudflare CDN infrastructure

  // ── Major SaaS & Developer Platforms ──
  'github.com',
  'github.io',
  'githubapp.com',
  // Note: githubusercontent.com and githubassets.com are in PLATFORM_DOMAINS (can host user content)
  'github.dev',
  'githubcopilot.com',
  'ghcr.io',
  'npmjs.com',
  'npmjs.org',
  'npm.io',
  'npm.community',
  'yarnpkg.com',

  'gitlab.com',
  'gitlab.net',
  'gitlab-static.net',
  'gitlab.io',

  'bitbucket.org',
  'atlassian.com',
  'atlassian.net',
  'jira.com',
  'confluence.com',
  'trello.com',

  'stackoverflow.com',
  'stackexchange.com',
  'serverfault.com',
  'superuser.com',
  'askubuntu.com',
  'stackapps.com',
  'mathoverflow.net',
  'stacksnippets.net',
  'sstatic.net',
  'imgur.com',

  'docker.com',
  'docker.io',
  'dockerhub.com',
  'docker.com.registry',

  'heroku.com',
  'herokuapp.com',
  'herokussl.com',

  'vercel.com',
  'vercel.app',
  'now.sh',
  'zeit.co',

  'netlify.com',
  'netlify.app',
  'netlifycms.com',

  'digitalocean.com',
  'digitaloceanspaces.com',
  'docker.io.digitalocean.com',

  'railway.app',
  'railway.com',

  'render.com',
  'onrender.com',

  'cloud.google.com',
  'firebase.google.com',

  // ── Standards Bodies & Organizations ──
  'w3.org',
  'w3c.org',
  'w3schools.com',
  'ietf.org',
  'icann.org',
  'iana.org',
  'iso.org',
  'ieee.org',
  'rfc-editor.org',
  'unicode.org',
  'whatwg.org',
  'ecma-international.org',
  'tc39.es',
  'webstandards.org',
  'internet-society.org',

  // ── Major Social Media ──
  'twitter.com',
  'x.com',
  'twimg.com',
  't.co',
  'abs.twimg.com',
  'pbs.twimg.com',
  'twttr.com',

  'reddit.com',
  'redd.it',
  'redditstatic.com',
  'redditmedia.com',
  'redditspace.com',
  'redditinc.com',

  'pinterest.com',
  'pinimg.com',
  'pinterest.ca',
  'pinterest.co.uk',

  'tumblr.com',
  'tumblr.lv',
  'tumblr.net',

  'tiktok.com',
  'tiktokcdn.com',
  'tiktokv.com',
  'musical.ly',
  'bytedance.com',
  'byteimg.com',
  'bytednsdoc.com',
  'ibytedtos.com',
  'bytegecko.com',
  'snssdk.com',

  'snapchat.com',
  'snap.com',
  'sc-cdn.net',
  'snapdev.net',

  'telegram.org',
  'telegram.me',
  't.me',
  'telegra.ph',
  'telesco.pe',

  'discord.com',
  'discord.gg',
  'discordapp.com',
  'discordapp.net',
  'discord.media',
  'discord-status.com',

  'slack.com',
  'slackb.com',
  'slack-edge.com',
  'slack-imgs.com',

  // ── Major Chinese Sites ──
  'baidu.com',
  'baidubox.com',
  'baidustatic.com',
  'bdimg.com',
  'bdstatic.com',
  'bcebos.com',
  'baidubce.com',

  'qq.com',
  'tencent.com',
  'weixin.qq.com',
  'wechat.com',
  'qpic.cn',
  'qlogo.cn',
  'gtimg.cn',
  'idqqimg.com',
  'myqcloud.com',
  'qcloud.com',
  'tencdns.com',
  'tencent-cloud.com',
  'tencent-cloud.net',
  'weixinbridge.com',
  'servicewechat.com',
  'wechatpay.net',

  'taobao.com',
  'tmall.com',
  'alibaba.com',
  'alipay.com',
  'alipayobjects.com',
  'alicdn.com',
  'aliyun.com',
  // Note: aliyuncs.com is in PLATFORM_DOMAINS (OSS buckets can host user content)
  'aliapp.org',
  'alidns.com',
  'alikunlun.com',
  'alicloud.com',
  '1688.com',
  'dingtalk.com',
  'dingtalkapps.com',
  'etao.com',
  'fliggy.com',
  'aliexpress.com',
  'lazada.com',
  'alimama.com',
  'alihealth.cn',
  'antgroup.com',
  'antfin.com',
  'mybank.cn',
  'xiami.com',
  'youku.com',
  'tudou.com',
  'soku.com',

  'jd.com',
  'jd.hk',
  'jdcdn.com',
  '360buyimg.com',
  'jdwl.com',
  'jdpay.com',
  'jddglobal.com',

  'bilibili.com',
  'biligcld.com',
  'bilivideo.com',
  'biliapi.com',
  'biliapi.net',
  'bilicdn1.com',
  'bilicdn2.com',
  'hdslb.com',
  'im9.com',
  'acgvideo.com',

  'douyin.com',
  'douyinpic.com',
  'douyincdn.com',
  'douyinliving.com',
  'douyinec.com',
  'amemv.com',
  'iesdouyin.com',
  'bytegoofy.com',
  'bytetcc.com',
  'feiliao.com',

  'weibo.com',
  'weibo.cn',
  'sina.com',
  'sina.com.cn',
  'sina.cn',
  'sinaimg.cn',
  'sinajs.cn',
  'sinawb.com',
  'sinaedge.com',

  'zhihu.com',
  'zhihu.hu',
  'zhimg.com',

  'douban.com',
  'doubanio.com',
  'douban.fm',

  '163.com',
  '126.com',
  '127.com',
  'netease.com',
  '127.net',
  'netease.com',
  'youdao.com',
  'lofter.com',
  'youdao.com',

  'meituan.com',
  'dianping.com',
  'meituan.net',
  'dpfile.com',

  'csdn.net',
  'csdn.com',
  'csdnimg.cn',
  'iteye.com',

  'juejin.cn',
  'juejin.im',
  'bytedance.com',
  'byteimg.com',

  'segmentfault.com',
  'sifou.com',

  'cloud.tencent.com',
  'qcloud.com',

  'huawei.com',
  'huaweicloud.com',
  'huaweicloud.net',
  'vmall.com',
  'hicloud.com',
  'hwccpc.com',

  'xiaomi.com',
  'mi.com',
  'miui.com',
  'mipay.com',
  'xiaomiyoupin.com',
  'micode.net',
  'mitalk.com',

  'oppo.com',
  'oppoer.me',
  'heytap.com',
  'heytapdownload.com',
  'oneplus.com',
  'oneplus.cn',

  'vivo.com',
  'vivo.com.cn',
  'vivoglobal.com',
  'bkb.tencent.com',

  'meizu.com',
  'meizu.cn',
  'flyme.cn',
  'mzres.com',

  // ── Major News & Media ──
  'bbc.com',
  'bbc.co.uk',
  'bbci.co.uk',
  'cnn.com',
  'cnnio.net',
  'nytimes.com',
  'nyt.com',
  'wsj.com',
  'reuters.com',
  'thomsonreuters.com',
  'theguardian.com',
  'gu-web.net',
  'washingtonpost.com',
  'washingtonpost.dev',
  'wp.com',
  'bloomberg.com',
  'bloomberg.org',
  'economist.com',
  'nature.com',
  'science.org',
  'sciencedirect.com',
  'springer.com',
  'springerlink.com',
  'arxiv.org',
  'doi.org',
  'researchgate.net',
  'semanticscholar.org',
  'scholar.google.com',

  // ── Major Cloud/Hosting ──
  'oracle.com',
  'oraclecloud.com',
  'oraclecdn.net',

  'ibm.com',
  'ibmcloud.com',
  'ibmdw.net',
  'bluemix.net',
  'softlayer.net',
  'ic0.dev',

  'salesforce.com',
  'force.com',
  'salesforceliveagent.com',
  'documentforce.com',
  'trailblazer.me',
  'sfdcstatic.com',

  'shopify.com',
  'shopifycdn.com',
  'shopifycloud.com',
  'myshopify.com',
  'shopifysvc.com',
  'shopifyapps.com',

  'squarespace.com',
  'squarespace-cdn.com',

  'wordpress.com',
  'wordpress.org',
  'wp.com',
  'wpengine.com',
  'wpmucdn.com',
  'wpstatic.com',
  'gravatar.com',
  'automattic.com',
  'jetpack.com',
  'woocommerce.com',

  'wix.com',
  'wixapps.net',
  'wixstatic.com',
  'parastorage.com',
  'editorx.io',

  'godaddy.com',
  'secureserver.net',
  'inmotionhosting.com',

  'cloudways.com',
  'kinsta.com',
  'pantheon.io',

  // ── Major Email Providers ──
  'mail.google.com',
  'outlook.com',
  'yahoo.com',
  'yahoo.co.jp',
  'yahooinc.com',
  'yahooapis.com',
  'yahoodns.net',
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'pm.me',
  'tutanota.com',
  'tutamail.com',
  'zoho.com',
  'zohocorp.com',
  'zohomail.com',
  'mail.ru',
  'yandex.com',
  'yandex.ru',
  'yandex.net',
  'ya.ru',

  // ── Security & Antivirus ──
  'virustotal.com',
  'abuse.ch',
  'spamhaus.org',
  'alienvault.com',
  'otx.alienvault.com',
  'phishtank.org',
  'openphish.com',
  'urlhaus.abuse.ch',
  'threatfox.abuse.ch',
  'blocklist.de',
  'cinsscore.com',
  'botvrij.eu',
  'kaspersky.com',
  'kaspersky.ru',
  'bitdefender.com',
  'eset.com',
  'mcafee.com',
  'norton.com',
  'nortonlifelock.com',
  'symantec.com',
  'sophos.com',
  'trendmicro.com',
  'avast.com',
  'avg.com',
  'avira.com',
  'paloaltonetworks.com',
  'crowdstrike.com',
  'fortinet.com',
  'checkpoint.com',
  'cisco.com',
  'juniper.net',
  'paloaltonetworks.com',
  'fireeye.com',
  'mandiant.com',
  'recordedfuture.com',
  'threatbook.cn',
  'qianxin.com',
  'nsfocus.com',
  'venustech.com.cn',
  'dbappsecurity.com.cn',
  'topsec.com.cn',
  'safedog.cn',
  'anquanbao.com',
  'safeid.org',

  // ── Payment & Finance ──
  'paypal.com',
  'paypalobjects.com',
  'stripe.com',
  'stripe.network',
  'stripe-cdn.com',
  'square.com',
  'squarecdn.com',
  'visa.com',
  'mastercard.com',
  'americanexpress.com',
  'discover.com',
  'adyen.com',
  'braintreegateway.com',
  'braintree-api.com',

  // ── Education ──
  'mit.edu',
  'stanford.edu',
  'harvard.edu',
  'yale.edu',
  'princeton.edu',
  'berkeley.edu',
  'cambridge.org',
  'ox.ac.uk',
  'tsinghua.edu.cn',
  'pku.edu.cn',
  'zju.edu.cn',
  'fudan.edu.cn',
  'sjtu.edu.cn',
  'ustc.edu.cn',
  'nju.edu.cn',
  'whu.edu.cn',
  'hust.edu.cn',
  'ruc.edu.cn',

  // ── Government ──
  'gov.cn',
  'gov.uk',
  'gov.au',
  'gov.ca',
  'gov.jp',
  'gov.sg',
  'gov.hk',
  'gov.tw',
  'gov.in',
  'usa.gov',
  'europe.eu',
  'europa.eu',
  'eu.int',
  'who.int',
  'un.org',
  'nato.int',
  'oecd.org',
  'imf.org',
  'worldbank.org',
  'wto.org',
  'fbi.gov',
  'cia.gov',
  'nsa.gov',
  'nist.gov',
  'cisa.gov',
  'dhs.gov',
  'sec.gov',
  'fcc.gov',
  'ftc.gov',
  'microsoftonline.com',

  // ── Web/Dev Resources ──
  'mdn.io',
  'developer.mozilla.org',
  'mozilla.org',
  'mozilla.com',
  'mozaws.net',
  'firefox.com',
  'firefoxusercontent.com',
  'thunderbird.net',
  'seamonkey-project.org',

  'apache.org',
  'apache.org.com',
  'httpd.apache.org',

  'nodejs.org',
  'nodejs.org.com',
  'npmjs.com',

  'python.org',
  'pypi.org',
  'pythonhosted.org',
  'readthedocs.io',
  'readthedocs.org',

  'ruby-lang.org',
  'rubygems.org',
  'rails.org',

  'php.net',
  'packagist.org',

  'golang.org',
  'go.dev',

  'rust-lang.org',
  'crates.io',
  'docs.rs',

  'swift.org',
  'developer.apple.com',

  'perl.org',
  'cpan.org',
  'metacpan.org',

  'jquery.com',
  'jquery.org',
  'code.jquery.com',

  'reactjs.org',
  'react.dev',
  'nextjs.org',
  'vercel.com',
  'vuejs.org',
  'angular.io',
  'angularjs.org',
  'svelte.dev',
  'tailwindcss.com',
  'getbootstrap.com',
  'bootstrapcdn.com',

  'webpack.js.org',
  'vitejs.dev',
  'rollupjs.org',
  'esbuild.github.io',
  'babeljs.io',
  'typescriptlang.org',
  'eslint.org',
  'prettier.io',
  'jestjs.io',
  'mochajs.org',
  'cypress.io',
  'playwright.dev',
  'selenium.dev',

  'nginx.org',
  'nginx.com',

  'redis.io',
  'redis.com',
  'redislabs.com',

  'mongodb.com',
  'mongodb.org',
  'mongoengine.org',

  'postgresql.org',
  'mysql.com',
  'sqlite.org',
  'mariadb.org',
  'mariadb.com',

  'elasticsearch.org',
  'elastic.co',
  'kibana.org',

  'grafana.com',
  'grafana.net',
  'prometheus.io',

  'docker.com',
  'kubernetes.io',
  'k8s.io',

  'jenkins.io',
  'travis-ci.org',
  'travis-ci.com',
  'circleci.com',
  'gitlab.com',
  'bitbucket.org',
  'codepen.io',
  'codesandbox.io',
  'stackblitz.com',
  'replit.com',
  'repl.co',
  'glitch.me',
  'glitch.com',

  // ── Analytics & Monitoring ──
  'plausible.io',
  'matomo.org',
  'sentry.io',
  'sentry-cdn.com',
  'datadoghq.com',
  'datad0g.com',
  'newrelic.com',
  'nr-data.net',
  'pingdom.com',
  'statuspage.io',
  'uptimerobot.com',
  'opsgenie.com',
  'pagerduty.com',
  'grafana.com',
  'splunk.com',

  // ── Common Reference/Utility Domains ──
  'wikipedia.org',
  'wikimedia.org',
  'wikimediafoundation.org',
  'wikidata.org',
  'wiktionary.org',
  'wikiquote.org',
  'wikibooks.org',
  'wikisource.org',
  'wikinews.org',
  'wikiversity.org',
  'wikivoyage.org',
  'wikimediacloud.org',
  'mediawiki.org',
  'w.wiki',

  'archive.org',
  'archive-it.org',
  'waybackmachine.org',

  'creativecommons.org',
  'creativecommons.net',

  'eff.org',
  'torproject.org',
  'letsencrypt.org',
  'lencr.org',

  'cdnjs.com',
  'jsdelivr.net',
  'unpkg.com',
  'rawgit.com',
  // Note: raw.githubusercontent.com and githubusercontent.com are in PLATFORM_DOMAINS (can host user content)

  'medium.com',
  'medium.systems',
  'cdn-images-medium.com',
  'substack.com',
  'substackcdn.com',

  'notion.so',
  'notion.site',
  'notion-static.com',

  'figma.com',
  'cdn.figma.com',

  'airtable.com',
  'airtablepages.com',

  'canva.com',
  'canva.cn',

  'dropbox.com',
  'dropboxapi.com',
  // Note: dropboxusercontent.com is in PLATFORM_DOMAINS (can host user content)
  'db.tt',

  'box.com',
  'boxcloud.com',
  'boxcdn.net',

  'drive.google.com',
  'docs.google.com',
  'sheets.google.com',
  'slides.google.com',
  'forms.google.com',
  'calendar.google.com',
  'maps.google.com',
  'play.google.com',
  'store.google.com',
  'photos.google.com',

  'adobe.com',
  'adobe.io',
  'adobecqms.net',
  'adobedtm.com',
  'adobeexchange.com',
  'adobesign.com',
  'acrobat.com',
  'behance.net',
  'behance.com',

  'flickr.com',
  'flickr.net',
  'staticflickr.com',

  'spotify.com',
  'scdn.co',
  'spotifycdn.com',
  'spotify.net',

  'soundcloud.com',
  'sndcdn.com',

  'twitch.tv',
  'ttvnw.net',
  'jtvnw.net',
  'twitchcdn.net',

  'steam.com',
  'steampowered.com',
  'steamcommunity.com',
  'steamstore.com',
  'steamcdn-a.akamaihd.net',
  'steamstatic.com',

  'epicgames.com',
  'epicgames.dev',
  'unrealengine.com',

  'roblox.com',
  'rbxcdn.com',
  'roblox.qq.com',

  'ea.com',
  'origin.com',
  'easports.com',

  'blizzard.com',
  'battle.net',
  'worldofwarcraft.com',

  'minecraft.net',
  'mojang.com',

  // ── DNS Providers ──
  'cloudflare-dns.com',
  'dns.google',
  'dns.quad9.net',
  'quad9.net',
  'opendns.com',
  'cleanbrowsing.org',
  'adguard.com',
  'adguard-dns.com',
  'nextdns.io',
  'controld.com',
  'controld freemode',

  // ── Additional Common Safe Domains ──
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'localhost',
  'local',
  'localhost.localdomain',
  'localhost4',
  'localhost6',
  'localdomain',
  'intranet',
  'internal',

  'ietf.org',
  'rfc-editor.org',
  'tools.ietf.org',

  'iana.org',
  'icann.org',
  'pki.goog',
  'crt.sh',
  'certspotter.org',
  'censys.io',
  'shodan.io',
  'zoomeye.org',
  'fofa.info',
  'hunter.io',
  'crt.sh',
]);

// ─── TLDs that should never be malicious (just the TLD itself, not domains ending in them) ─────
const SAFE_TLDS: Set<string> = new Set([
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int',
  'io', 'dev', 'app', 'cloud', 'online', 'site',
  'info', 'biz', 'me', 'tv', 'co', 'us', 'uk', 'de', 'fr',
  'jp', 'cn', 'kr', 'in', 'au', 'ca', 'ru', 'br', 'it', 'es',
  'nl', 'se', 'no', 'ch', 'at', 'be', 'dk', 'fi', 'pt', 'ie',
  'nz', 'sg', 'hk', 'tw', 'my', 'th', 'id', 'ph', 'vn', 'za',
  'mx', 'ar', 'cl', 'co', 'pe', 'ec', 've', 'pl', 'cz', 'hu',
  'ro', 'bg', 'hr', 'sk', 'si', 'lt', 'lv', 'ee', 'tr', 'gr',
  'il', 'ae', 'sa', 'qa', 'kw', 'bh', 'om', 'pk', 'bd', 'lk',
  'mm', 'kh', 'la', 'mn', 'np',
]);

// ─── Platform domains where subdomains are user-controlled ─────────────────────────────
// These domains are "safe" at the root level (the platform itself is legitimate),
// but their SUBDOMAINS are user-controlled and CAN host phishing/malicious content.
// For these domains, ONLY the exact root domain is blocked from the malicious library,
// NOT subdomains. This allows phishing pages like "evil-user.github.io" to still be tracked.
//
// Example: "github.io" is safe → block from malicious library
//          "evil-user.github.io" is NOT safe → allow in malicious library (it's a phishing page)
const PLATFORM_DOMAINS: Set<string> = new Set([
  // GitHub Pages
  'github.io',

  // Cloudflare Pages & Workers & Tunnels
  'pages.dev',
  'workers.dev',
  'cloudflare.com',         // trycloudflare.com tunnels can host malicious content
  'trycloudflare.com',      // Cloudflare tunnels host user content

  // Vercel
  'vercel.app',
  'now.sh',

  // Netlify
  'netlify.app',

  // Heroku
  'herokuapp.com',

  // Render
  'onrender.com',

  // Railway
  'railway.app',
  'up.railway.app',

  // Glitch
  'glitch.me',

  // Replit
  'repl.co',

  // Blogspot (Google)
  'blogspot.com',

  // WordPress
  'wordpress.com',

  // Wix
  'wixsite.com',

  // Squarespace
  'squarespace.com',

  // Weebly
  'weebly.com',

  // GitLab Pages
  'gitlab.io',

  // Fastly
  'fastly.net',

  // AWS — S3 buckets and other services can host user content
  'amazonaws.com',
  's3.amazonaws.com',
  's3-website.amazonaws.com',
  's3-website-us-east-1.amazonaws.com',
  's3-website-us-west-1.amazonaws.com',
  's3-website-us-west-2.amazonaws.com',
  's3-website-eu-west-1.amazonaws.com',
  's3-website-ap-northeast-1.amazonaws.com',
  's3-website-sa-east-1.amazonaws.com',

  // Azure Static Web Apps
  'azurestaticapps.net',
  'azurewebsites.net',

  // Google Sites & user content
  'sites.google.com',
  'googleusercontent.com',
  'googleapis.com',
  // Note: firebasestorage.googleapis.com is NOT safe - it's a subdomain of googleapis.com
  // and can host user content, so it will be allowed in the malicious library

  // GitHub user content (can host malware in repos)
  'githubusercontent.com',
  'githubassets.com',
  'raw.githubusercontent.com',

  // Discord CDN (can host malicious files)
  'discordapp.com',
  'discord.com',

  // Tumblr
  'tumblr.com',

  // Shopify
  'myshopify.com',

  // CodePen
  'codepen.io',

  // Codesandbox
  'codesandbox.io',

  // StackBlitz
  'stackblitz.com',

  // Surge
  'surge.sh',

  // Dropbox user content
  'dl.dropboxusercontent.com',
  'dropboxusercontent.com',

  // Sourceforge
  'sourceforge.io',

  // PythonAnywhere
  'pythonanywhere.com',

  // InfinityFree
  'infinityfree.com',

  // 000webhost
  '000webhostapp.com',

  // Fleek
  'fleek.co',
  'on.fleek.co',

  // IPFS gateways
  'ipfs.dweb.link',
  'cloudflare-ipfs.com',
  'gateway.pinata.cloud',
  'ipfs.io',

  // Archive.org — specific pages can host malware
  'archive.org',

  // QQ/MyQCloud COS buckets
  'myqcloud.com',

  // Alibaba Cloud (Aliyun) — OSS buckets and other services host user content
  'aliyuncs.com',

  // Secureserver.net (GoDaddy hosting)
  'secureserver.net',

  // Python hosted packages
  'pythonhosted.org',

  // OneDrive/Sharepoint user content
  '1drv.com',
  'sharepoint.com',

  // Freenom free domains
  'tk', 'ml', 'ga', 'cf', 'gq',
]);

/**
 * Check if a domain is a well-known safe domain that should never be in the malicious library.
 *
 * This checks:
 * 1. Exact match against the whitelist
 * 2. Whether the domain is a subdomain of a whitelisted domain
 * 3. Whether the domain is just a TLD (like "com", "org")
 * 4. Whether the domain is too short (1-3 chars for the first label)
 *
 * IMPORTANT: Platform domains (github.io, pages.dev, vercel.app, etc.) are handled
 * specially — only the exact root domain is blocked, NOT subdomains. This is because
 * subdomains on these platforms are user-controlled and can host phishing/malicious content.
 * For example: "github.io" is safe (platform root), but "evil-user.github.io" is NOT safe
 * (user-controlled subdomain that may host phishing).
 *
 * @param domain - The domain to check
 * @returns true if the domain is considered safe and should be filtered out
 */
export function isSafeDomain(domain: string): boolean {
  if (!domain || typeof domain !== 'string') return true; // Treat invalid as safe (skip it)

  const normalized = domain.toLowerCase().trim();

  // Empty or whitespace-only
  if (normalized.length === 0) return true;

  // Split domain into parts for various checks
  const parts = normalized.split('.');
  const firstLabel = parts[0];

  // Filter out domains that are just TLDs
  if (SAFE_TLDS.has(normalized)) return true;

  // Filter out very short domains (1-2 chars) on well-known TLDs
  // Only apply this for common TLDs where short domains are almost always safe
  // For unusual TLDs (.wtf, .lk, .xyz, etc.), short domains can still be malicious
  const COMMON_TLDS = new Set(['com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'io', 'co', 'me', 'tv']);
  const tld = parts.length >= 2 ? parts[parts.length - 1] : '';
  if (firstLabel.length <= 2 && COMMON_TLDS.has(tld) && parts.length <= 2) {
    // Very short root domains on common TLDs like "a.com", "ab.com" — almost never malicious
    return true;
  }

  // Exact match — the root domain itself is always safe
  // This includes both SAFE_DOMAINS and PLATFORM_DOMAINS (platform roots are safe)
  if (SAFE_DOMAINS.has(normalized)) return true;
  if (PLATFORM_DOMAINS.has(normalized)) return true;

  // Check if it's a subdomain of a safe domain
  // IMPORTANT: Platform domains (github.io, pages.dev, etc.) are excluded from
  // subdomain matching because their subdomains are user-controlled and can be malicious.
  for (let i = 1; i < parts.length; i++) {
    const parentDomain = parts.slice(i).join('.');
    // Skip subdomain matching for platform domains — only exact match blocks them
    if (PLATFORM_DOMAINS.has(parentDomain)) continue;
    // For non-platform safe domains, subdomains are also safe
    if (SAFE_DOMAINS.has(parentDomain)) return true;
  }

  return false;
}

/**
 * Check if an IP address is obviously safe (private/reserved ranges).
 * These should never appear in the malicious library.
 *
 * @param ip - The IP address to check
 * @returns true if the IP is considered safe and should be filtered out
 */
export function isSafeIP(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return true;

  const normalized = ip.trim();

  // Private IP ranges (RFC 1918)
  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(normalized)) return true;

  // Loopback
  if (normalized.startsWith('127.')) return true;
  if (normalized === '0.0.0.0') return true;
  if (normalized === '::1') return true;

  // Link-local
  if (normalized.startsWith('169.254.')) return true;
  if (normalized.startsWith('fe80:')) return true;

  // Multicast
  if (/^22[4-9]\./.test(normalized) || /^23[0-9]\./.test(normalized)) return true;

  // Reserved
  if (normalized.startsWith('100.64.') || normalized.startsWith('100.65.') ||
      normalized.startsWith('100.66.') || normalized.startsWith('100.67.') ||
      normalized.startsWith('100.68.') || normalized.startsWith('100.69.') ||
      normalized.startsWith('100.7')) return true; // Carrier-grade NAT

  // Broadcast
  if (normalized === '255.255.255.255') return true;

  return false;
}

/**
 * Filter an array of domain entries, removing safe domains.
 * Returns the filtered array (safe domains removed).
 *
 * @param domains - Array of domain entry objects with a 'domain' field
 * @returns Filtered array with safe domains removed
 */
export function filterSafeDomains<T extends { domain: string }>(domains: T[]): T[] {
  return domains.filter(entry => !isSafeDomain(entry.domain));
}

/**
 * Filter an array of IP entries, removing safe IPs.
 * Returns the filtered array (safe IPs removed).
 *
 * @param ips - Array of IP entry objects with an 'ip' field
 * @returns Filtered array with safe IPs removed
 */
export function filterSafeIPs<T extends { ip: string }>(ips: T[]): T[] {
  return ips.filter(entry => !isSafeIP(entry.ip));
}

/**
 * Filter threat intel entries, removing safe values.
 * Works with entries that have 'type' and 'value' fields.
 *
 * @param entries - Array of threat intel entry objects
 * @returns Filtered array with safe entries removed
 */
export function filterSafeEntries<T extends { type: string; value: string }>(entries: T[]): T[] {
  return entries.filter(entry => {
    if (entry.type === 'domain') {
      return !isSafeDomain(entry.value);
    } else if (entry.type === 'ip') {
      return !isSafeIP(entry.value);
    }
    return true; // Keep unknown types
  });
}

/**
 * Get the full set of safe domains (for cleanup scripts).
 * @returns A copy of the safe domains Set
 */
export function getSafeDomainSet(): Set<string> {
  return new Set(SAFE_DOMAINS);
}

/**
 * Get the full set of platform domains (for cleanup scripts).
 * Platform domains are safe at root but user-controlled at subdomains.
 * @returns A copy of the platform domains Set
 */
export function getPlatformDomainSet(): Set<string> {
  return new Set(PLATFORM_DOMAINS);
}
