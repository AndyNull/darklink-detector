import {
  FileCode,
  Globe,
  Shield,
  AlertTriangle,
  Eye,
  Info,
  Wrench,
  RefreshCw,
  Download,
  Database,
  User,
  Clock,
  Loader2,
  CheckCircle2,
  X,
  XCircle,
  Cpu,
  FileText,
} from 'lucide-react';

// --- Types ---

export interface SettingsPanelProps {
  onClose: () => void;
}

export type SourceStatus = 'active' | 'stale' | 'deprecated' | 'needs-key';
export type DataQuality = 'good' | 'limited' | 'poor';
export type SettingsCategory = 'system' | 'engine' | 'data-sync' | 'sync-progress' | 'detection-rules' | 'database' | 'account' | 'logs';

export interface SourceInfo {
  id: string;
  name: string;
  description: string;
  type: string;
  url: string;
  domainCount: number;
  ipCount: number;
  totalCount: number;
  status: SourceStatus;
  keyAvailable: boolean;
  dataQuality: DataQuality;
  statusNote?: string;
}

export interface DetectionRule {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
}

export interface ApiKeyConfig {
  id: string;
  name: string;
  sourceId: string;
  placeholder: string;
  registerUrl?: string;
}

export interface ScheduleInfo {
  enabled: boolean;
  frequency: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  status: string;
}

export interface DatabaseConfigSqlite {
  path: string;
}

export interface DatabaseConfigMysql {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export interface DatabaseConfigPostgresql {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}

export interface DatabaseConfig {
  type: 'sqlite' | 'mysql' | 'postgresql';
  sqlite: DatabaseConfigSqlite;
  mysql: DatabaseConfigMysql;
  postgresql: DatabaseConfigPostgresql;
}

export interface SyncTaskInfo {
  id: string;
  name: string;
  sources: string;
  status: string;
  progress: number;
  totalSources: number;
  completedSources: number;
  failedSources: number;
  results: string | null;
  message: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string | null;
}

// --- Constants ---

export const DETECTION_RULES: DetectionRule[] = [
  // CSS/样式隐藏
  { id: 'css_hidden', name: 'CSS隐藏', description: 'display:none, visibility:hidden, opacity:0', defaultEnabled: true },
  { id: 'size_hidden', name: '尺寸隐藏', description: 'font-size:0, width:0, height:0', defaultEnabled: true },
  { id: 'color_hidden', name: '颜色隐藏', description: '文字与背景同色隐藏', defaultEnabled: true },
  { id: 'position_hidden', name: '位置隐藏', description: '负偏移, text-indent, left:-9999px', defaultEnabled: true },
  { id: 'overflow_hidden', name: '溢出隐藏', description: 'overflow:hidden+尺寸为0', defaultEnabled: true },
  // 嵌入/注入检测
  { id: 'iframe_hidden', name: '隐藏iframe', description: '0x0/1x1尺寸iframe', defaultEnabled: true },
  { id: 'suspicious_domain', name: '可疑域名', description: '与主域名差异大的外链', defaultEnabled: true },
  { id: 'qr_code', name: 'QR码暗链', description: '解析QR码指向可疑URL', defaultEnabled: true },
  { id: 'js_injected', name: 'JS注入', description: '内联脚本中的外部URL', defaultEnabled: true },
  { id: 'base_redirect', name: 'Base标签重定向', description: 'base标签修改页面基准URL', defaultEnabled: true },
  // 高级检测
  { id: 'js_obfuscated', name: 'JS混淆检测', description: 'eval/atob/fromCharCode/unescape', defaultEnabled: true },
  { id: 'meta_refresh', name: 'Meta刷新', description: 'meta refresh重定向', defaultEnabled: true },
  { id: 'mixed_content', name: '混合内容', description: 'HTTPS页面加载HTTP资源(安全降级)', defaultEnabled: true },
  { id: 'form_hijack', name: '表单劫持', description: '表单提交至外部域名', defaultEnabled: true },
  { id: 'svg_hidden', name: 'SVG隐藏链接', description: 'SVG中的隐藏链接', defaultEnabled: false },
  // 恶意内容检测
  { id: 'malicious_keyword', name: '恶意关键词', description: 'URL包含赌博/钓鱼/色情/诈骗关键词', defaultEnabled: true },
  { id: 'suspicious_shortener', name: '可疑短链', description: 'bit.ly/t.cn等短链服务', defaultEnabled: true },
  { id: 'cheap_tld', name: '廉价域名', description: '.xyz/.top/.cc等易滥用顶级域名', defaultEnabled: true },
  { id: 'keyword_stuffing', name: '关键词堆砌', description: 'Meta标签含多个恶意关键词', defaultEnabled: true },
  { id: 'link_farm', name: '链接农场', description: '大量外链至廉价/短链域名', defaultEnabled: true },
  // 隐藏链接检测
  { id: 'hidden_text', name: '隐藏文本', description: '零字号或同色文本中的链接', defaultEnabled: true },
  { id: 'hidden_div_link', name: '隐藏容器链接', description: 'display:none容器中的链接', defaultEnabled: true },
  { id: 'nofollow_suspicious', name: 'Nofollow可疑链接', description: '带rel=nofollow的外部可疑链接', defaultEnabled: false },
  // 其他检测
  { id: 'data_uri', name: 'Data URI', description: 'data:协议链接/Base64内嵌', defaultEnabled: false },
  { id: 'noscript_hidden', name: 'Noscript隐藏', description: '仅noscript标签中的链接', defaultEnabled: false },
];

// Rule categories for grouping display
export const RULE_CATEGORIES = [
  { label: 'CSS/样式隐藏', icon: FileCode, ruleIds: ['css_hidden', 'size_hidden', 'color_hidden', 'position_hidden', 'overflow_hidden'] },
  { label: '嵌入/注入检测', icon: Globe, ruleIds: ['iframe_hidden', 'suspicious_domain', 'qr_code', 'js_injected', 'base_redirect'] },
  { label: '高级检测', icon: Shield, ruleIds: ['js_obfuscated', 'meta_refresh', 'mixed_content', 'form_hijack', 'svg_hidden'] },
  { label: '恶意内容检测', icon: AlertTriangle, ruleIds: ['malicious_keyword', 'suspicious_shortener', 'cheap_tld', 'keyword_stuffing', 'link_farm'] },
  { label: '隐藏链接检测', icon: Eye, ruleIds: ['hidden_text', 'hidden_div_link', 'nofollow_suspicious'] },
  { label: '其他检测', icon: Info, ruleIds: ['data_uri', 'noscript_hidden'] },
];

export const STATIC_SOURCES: SourceInfo[] = [
  {
    id: 'openphish', name: 'OpenPhish', description: '钓鱼URL实时订阅，每日更新', type: 'domain', url: 'https://openphish.com/',
    domainCount: 0, ipCount: 0, totalCount: 0,
    status: 'active', keyAvailable: false, dataQuality: 'good',
    statusNote: '免费公开，无需API Key，feed.txt每日更新',
  },
  {
    id: 'urlhaus', name: 'URLhaus', description: '恶意URL分发平台，由abuse.ch维护', type: 'both', url: 'https://urlhaus.abuse.ch/',
    domainCount: 0, ipCount: 0, totalCount: 0,
    status: 'active', keyAvailable: false, dataQuality: 'good',
    statusNote: '免费公开，持续更新，数据可靠',
  },
  {
    id: 'threatfox', name: 'ThreatFox', description: 'IOC威胁情报，由abuse.ch维护', type: 'both', url: 'https://threatfox.abuse.ch/',
    domainCount: 0, ipCount: 0, totalCount: 0,
    status: 'active', keyAvailable: false, dataQuality: 'good',
    statusNote: '免费CSV导出(15万+ IOC)，API需认证',
  },
  {
    id: 'blocklist-de', name: 'Blocklist.de', description: '攻击IP列表，社区驱动', type: 'ip', url: 'https://www.blocklist.de/',
    domainCount: 0, ipCount: 0, totalCount: 0,
    status: 'active', keyAvailable: false, dataQuality: 'good',
    statusNote: '免费公开，持续更新',
  },
  {
    id: 'cins-army', name: 'CINS Army', description: '恶意IP情报，被动DNS数据', type: 'ip', url: 'https://cinsscore.com/',
    domainCount: 0, ipCount: 0, totalCount: 0,
    status: 'active', keyAvailable: false, dataQuality: 'good',
    statusNote: '免费公开，持续更新',
  },
  {
    id: 'spamhaus-drop', name: 'Spamhaus DROP', description: '已知垃圾邮件/恶意IP段(含EDROP)', type: 'ip', url: 'https://www.spamhaus.org/',
    domainCount: 0, ipCount: 0, totalCount: 0,
    status: 'active', keyAvailable: false, dataQuality: 'good',
    statusNote: '免费公开，定期更新，数据权威',
  },
  {
    id: 'alienvault-otx', name: 'AlienVault OTX', description: '开放威胁交换，社区驱动IOC', type: 'both', url: 'https://otx.alienvault.com/',
    domainCount: 0, ipCount: 0, totalCount: 0,
    status: 'active', keyAvailable: true, dataQuality: 'good',
    statusNote: '免费可用(无需Key可获取最新Pulse)，配置Key可提高频率限制',
  },
  {
    id: 'phishtank', name: 'PhishTank', description: '社区钓鱼URL数据库', type: 'domain', url: 'https://phishtank.org/',
    domainCount: 0, ipCount: 0, totalCount: 0,
    status: 'active', keyAvailable: true, dataQuality: 'good',
    statusNote: '免费JSON端点可用，API Key可获取更完整数据',
  },
  {
    id: 'virustotal', name: 'VirusTotal', description: '多引擎恶意文件/URL/IP检测', type: 'both', url: 'https://www.virustotal.com/',
    domainCount: 0, ipCount: 0, totalCount: 0,
    status: 'needs-key', keyAvailable: true, dataQuality: 'limited',
    statusNote: '仅查询模式(免费Key 500次/天,4次/分钟，不适合批量抓取)',
  },
  {
    id: 'threatbook', name: 'ThreatBook/微步', description: '微步在线威胁情报查询API，需API Key验证指标', type: 'both', url: 'https://x.threatbook.com/',
    domainCount: 0, ipCount: 0, totalCount: 0,
    status: 'needs-key', keyAvailable: true, dataQuality: 'good',
    statusNote: '仅查询模式(API需认证，免费100次/天，不适合批量抓取)',
  },
  {
    id: 'abuseipdb', name: 'AbuseIPDB', description: 'IP滥用报告平台', type: 'ip', url: 'https://www.abuseipdb.com/',
    domainCount: 0, ipCount: 0, totalCount: 0,
    status: 'needs-key', keyAvailable: true, dataQuality: 'good',
    statusNote: '仅查询模式(免费1000次/天，不适合批量抓取)',
  },
];

export const API_KEY_CONFIGS: ApiKeyConfig[] = [
  // Optional keys (sources work without key, key enhances data)
  {
    id: 'alienvault-otx', name: 'AlienVault OTX API Key (可选)', sourceId: 'alienvault-otx',
    placeholder: '输入AlienVault OTX API Key...',
    registerUrl: 'https://otx.alienvault.com/signup',
  },
  {
    id: 'phishtank', name: 'PhishTank API Key (可选)', sourceId: 'phishtank',
    placeholder: '输入PhishTank API Key...',
    registerUrl: 'https://www.phishtank.com/register.php',
  },
  // Required keys (sources need key to function)
  {
    id: 'virustotal', name: 'VirusTotal API Key', sourceId: 'virustotal',
    placeholder: '输入VirusTotal API Key...',
    registerUrl: 'https://www.virustotal.com/gui/join-us',
  },
  {
    id: 'threatbook', name: 'ThreatBook/微步 API Key', sourceId: 'threatbook',
    placeholder: '输入微步API Key...',
    registerUrl: 'https://x.threatbook.com/',
  },
  {
    id: 'abuseipdb', name: 'AbuseIPDB API Key', sourceId: 'abuseipdb',
    placeholder: '输入AbuseIPDB API Key...',
    registerUrl: 'https://www.abuseipdb.com/api',
  },

];

// Sources that are query-only (rate-limited, not for bulk collection)
export const QUERY_ONLY_SOURCES = new Set(['virustotal', 'abuseipdb', 'threatbook']);

// Sources that require an API key (includes both bulk and query-only)
export const API_KEY_SOURCES = new Set(['alienvault-otx', 'virustotal', 'threatbook', 'abuseipdb', 'phishtank']);

export const RULES_STORAGE_KEY = 'darklink-detection-rules';
export const API_KEY_PREFIX = 'darklink-api-key-';

// --- Sidebar Navigation Items ---

export const SIDEBAR_ITEMS: { key: SettingsCategory; icon: React.ElementType; label: string }[] = [
  { key: 'system', icon: Wrench, label: '系统设置' },
  { key: 'engine', icon: Cpu, label: '引擎管理' },
  { key: 'data-sync', icon: RefreshCw, label: '情报源配置' },
  { key: 'sync-progress', icon: Download, label: '数据同步' },
  { key: 'detection-rules', icon: FileCode, label: '解析规则' },
  { key: 'database', icon: Database, label: '数据库配置' },
  { key: 'account', icon: User, label: '账户管理' },
  { key: 'logs', icon: FileText, label: '审计日志' },
];

export const SYNC_STATUS_CONFIG: Record<string, { color: string; bg: string; label: string; icon: React.ElementType }> = {
  pending: { color: 'text-muted-foreground', bg: 'bg-muted/50', label: '等待中', icon: Clock },
  running: { color: 'text-primary', bg: 'bg-primary/10', label: '运行中', icon: Loader2 },
  paused: { color: 'text-yellow-600', bg: 'bg-yellow-500/10', label: '已暂停', icon: AlertTriangle },
  completed: { color: 'text-green-600', bg: 'bg-green-500/10', label: '已完成', icon: CheckCircle2 },
  failed: { color: 'text-red-500', bg: 'bg-red-500/10', label: '失败', icon: XCircle },
  cancelled: { color: 'text-muted-foreground', bg: 'bg-muted/50', label: '已取消', icon: X },
};
