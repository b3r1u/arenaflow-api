const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const routes    = require('./routes');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// ─── Helmet — headers de segurança HTTP (M1) ──────────────────────────────────
app.use(helmet({
  // CSP desabilitado: a API só retorna JSON, não HTML
  contentSecurityPolicy: false,
}));

// ─── CORS (M4) ────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:4200,http://localhost:4201,http://localhost:4300')
  .split(',')
  .map(o => o.trim());

const corsOptions = {
  origin: (origin, callback) => {
    // Webhook Pagar.me é server-to-server: sem Origin → sempre permitido
    // Em dev: sem Origin também permitido (Postman, curl)
    // Em produção: sem Origin bloqueado para rotas não-webhook
    if (!origin) {
      return isProd
        ? callback(new Error('Requisições sem Origin não são permitidas em produção'))
        : callback(null, true);
    }
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`Origem não permitida pelo CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};

// Webhook bypassa CORS — Pagar.me não envia header Origin
app.use('/api/webhook', cors({ origin: '*' }));
app.use(cors(corsOptions));

// Responde explicitamente a qualquer preflight OPTIONS antes das rotas/auth
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// ─── Body parsing ─────────────────────────────────────────────────────────────
// Captura rawBody para validação HMAC em webhooks (C2)
// Limite reduzido de 10 MB → 500 KB; imagens de logo devem usar URL externa (M2)
app.use(express.json({
  limit: '500kb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true, limit: '500kb' }));

// ─── Rate Limiting (C4) ───────────────────────────────────────────────────────
const rateLimitMessage = { error: 'Muitas requisições. Tente novamente em alguns instantes.' };

// Geral: 200 req / 15 min por IP
const generalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         rateLimitMessage,
});

// Auth (login, registro): 15 req / 15 min por IP — proteção contra brute-force
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             15,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         rateLimitMessage,
});

// Pagamentos (criação de ordem Pix): 30 req / 15 min por IP
const paymentLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         rateLimitMessage,
});

// Webhook Pagar.me: 120 req / 15 min (Pagar.me pode reenviar eventos)
const webhookLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             120,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         rateLimitMessage,
});

app.use('/api/auth',              authLimiter);
app.use('/api/webhook',           webhookLimiter);
app.use('/api/bookings',          paymentLimiter);
app.use('/api/pagamento',         paymentLimiter);
app.use('/api',                   generalLimiter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Rotas ────────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// ─── Error handler (H1 + M6) ─────────────────────────────────────────────────
// Em produção: mensagem genérica ao cliente, detalhe apenas no log interno
// Em desenvolvimento: mensagem completa + stack trace para facilitar debug
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  console.error(`[ERROR] ${status}`, err.message);
  if (!isProd) console.error(err.stack);

  const body = isProd
    ? { error: status < 500 ? err.message : 'Erro interno do servidor' }
    : { error: err.message, stack: err.stack };

  res.status(status).json(body);
});

module.exports = app;
