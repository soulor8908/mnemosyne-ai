// RAGAS 评估测试集
//
// 50 条问答对，覆盖 RAG 系统的典型场景和 hard case：
//   - 事实型问答（单笔记即可回答）
//   - 综合型问答（需跨笔记关联）
//   - 无答案场景（知识库无相关内容，应拒答）
//   - 跨时间关联（不同时间写的笔记有联系）
//
// 每条样本含：question / groundTruth / relevantNoteIds（相关笔记的 ID）
// 评估时用 hybridSearch 检索，把检索到的笔记内容作为 contexts，
// 用 /api/chat 生成 answer，再调 evaluateSingle 打分。
//
// 测试集与代码解耦：relevantNoteIds 是占位符，实际运行时由
// eval-runner 注入真实笔记 ID（见 runEval 函数）。
export interface EvalSample {
  id: string;
  category: 'factual' | 'synthesis' | 'no-answer' | 'cross-time';
  question: string;
  groundTruth: string;
  // 用关键词描述应该匹配到什么样的笔记，运行时由 eval-runner 在库里找
  relevantKeywords: string[];
}

export const TEST_SET: EvalSample[] = [
  // === 事实型问答（10 条）===
  {
    id: 'f001',
    category: 'factual',
    question: 'SCRAM-lite 登录协议的三个派生量是什么？',
    groundTruth: 'userId = H(masterKey), verifier = H(masterKey), response = H(verifier|challenge)',
    relevantKeywords: ['SCRAM', 'verifier', 'userId', 'challenge'],
  },
  {
    id: 'f002',
    category: 'factual',
    question: 'BIP39 助记词有多少个词？熵是多少 bit？',
    groundTruth: '12 个词，128 bit 熵',
    relevantKeywords: ['BIP39', '助记词', '128'],
  },
  {
    id: 'f003',
    category: 'factual',
    question: 'cosineSimilarity 维度不匹配时返回什么？',
    groundTruth: '返回 0（表示正交/无关）',
    relevantKeywords: ['cosineSimilarity', '维度', '0'],
  },
  {
    id: 'f004',
    category: 'factual',
    question: 'RRF 融合的平滑常数 k 默认值是多少？',
    groundTruth: 'k=60',
    relevantKeywords: ['RRF', 'k', '60'],
  },
  {
    id: 'f005',
    category: 'factual',
    question: 'MCP Server 用什么传输方式？为什么不用 HTTP？',
    groundTruth: '用 stdio，因为 Claude Desktop 通过子进程拉起，stdin/stdout 是天然通信通道',
    relevantKeywords: ['MCP', 'stdio', 'StdioServerTransport'],
  },
  {
    id: 'f006',
    category: 'factual',
    question: '本地嵌入模型是什么？多少维？',
    groundTruth: 'Xenova/all-MiniLM-L6-v2，384 维',
    relevantKeywords: ['all-MiniLM-L6-v2', '384', 'local'],
  },
  {
    id: 'f007',
    category: 'factual',
    question: '云端嵌入模型是什么？多少维？',
    groundTruth: '@cf/baai/bge-base-en-v1.5，768 维',
    relevantKeywords: ['bge-base-en-v1.5', '768', 'cloud'],
  },
  {
    id: 'f008',
    category: 'factual',
    question: '零信任守卫比较令牌时为什么先 sha256 再比？',
    groundTruth: '防止时序侧信道攻击，哈希后比较时间恒定',
    relevantKeywords: ['sha256', '时序', '侧信道'],
  },
  {
    id: 'f009',
    category: 'factual',
    question: '会话令牌的 TTL 是多少天？',
    groundTruth: '7 天',
    relevantKeywords: ['session', 'TTL', '7'],
  },
  {
    id: 'f010',
    category: 'factual',
    question: 'challenge 的 TTL 是多少秒？为什么一次性消费？',
    groundTruth: '120 秒，一次性消费防止重放攻击',
    relevantKeywords: ['challenge', '120', '重放'],
  },

  // === 综合型问答（需跨笔记关联，10 条）===
  {
    id: 's001',
    category: 'synthesis',
    question: '我的零信任登录和加密同步是怎么配合的？',
    groundTruth: '登录用 SCRAM-lite 验证身份但不传 masterKey，同步时用 masterKey 加密笔记内容上传 KV',
    relevantKeywords: ['SCRAM', 'masterKey', 'syncNoteUp', 'encryptJSON'],
  },
  {
    id: 's002',
    category: 'synthesis',
    question: '混合检索的语义检索为什么会静默失效？怎么修的？',
    groundTruth: 'query 与存储向量维度不匹配（384 vs 768）导致 cosine 恒 0，修复是严格按模型过滤',
    relevantKeywords: ['维度', 'cosine', 'model', 'filter'],
  },
  {
    id: 's003',
    category: 'synthesis',
    question: 'MCP Server 怎么在端到端加密前提下让外部 Agent 检索？',
    groundTruth: '三层降级：只返回 queryVector / 本地导出文件关键词检索 / 离线降级',
    relevantKeywords: ['MCP', 'queryVector', 'localMatches', '降级'],
  },
  {
    id: 's004',
    category: 'synthesis',
    question: 'Agent 生成双链提议的流程是什么？',
    groundTruth: '加载近7日笔记→算嵌入余弦相似度→阈值0.6过滤→检查已有双链→创建link提议',
    relevantKeywords: ['Agent', 'cosineSimilarity', '0.6', 'bilink', 'proposal'],
  },
  {
    id: 's005',
    category: 'synthesis',
    question: '本地模式和云端模式嵌入切换时会有什么问题？',
    groundTruth: '已存储的向量不会重新生成，导致新旧向量维度不同，需严格按模型过滤',
    relevantKeywords: ['模式', '切换', '维度', 'filter'],
  },
  {
    id: 's006',
    category: 'synthesis',
    question: '飞书捕获的工作流是怎么把文章变成知识点的？',
    groundTruth: '读飞书消息→提取URL→WebFetch抓正文→AI生成summary/knowledgePoints/tags→写inbox md',
    relevantKeywords: ['飞书', 'inbox', 'knowledgePoints', 'summary'],
  },
  {
    id: 's007',
    category: 'synthesis',
    question: '同步冲突时怎么处理本地未提交的编辑？',
    groundTruth: '保存本地内容快照到snapshots表，写入远程版本，标记syncStatus=conflict',
    relevantKeywords: ['conflict', 'snapshot', 'pending', 'syncStatus'],
  },
  {
    id: 's008',
    category: 'synthesis',
    question: '网页剪藏的正文提取是怎么做到无 DOM 依赖的？',
    groundTruth: '纯函数实现，article/main 标签优先，正则提取，Workers 环境可跑',
    relevantKeywords: ['grounding', 'article', 'main', '纯函数'],
  },
  {
    id: 's009',
    category: 'synthesis',
    question: 'Cross-Encoder 重排比 Bi-Encoder 慢多少？为什么要用？',
    groundTruth: '慢10-100x，但精度更高，所以先 Bi-Encoder 召回 top-20 再 Cross-Encoder 重排 top-5',
    relevantKeywords: ['Cross-Encoder', 'Bi-Encoder', 'top-20', '重排'],
  },
  {
    id: 's010',
    category: 'synthesis',
    question: '助记词校验为什么要加 checksum？',
    groundTruth: '只校验词数和词表时，12个合法词乱序也能通过，checksum 能检出顺序错误',
    relevantKeywords: ['checksum', '顺序', '校验', 'BIP39'],
  },

  // === 无答案场景（应拒答，10 条）===
  {
    id: 'n001',
    category: 'no-answer',
    question: 'Mnemosyne 的商业模式是什么？收费吗？',
    groundTruth: '（知识库无相关内容，应拒答）',
    relevantKeywords: ['不存在', '无答案'],
  },
  {
    id: 'n002',
    category: 'no-answer',
    question: '这个项目有多少用户？DAU 是多少？',
    groundTruth: '（知识库无相关内容，应拒答）',
    relevantKeywords: ['不存在', '无答案'],
  },
  {
    id: 'n003',
    category: 'no-answer',
    question: 'Mnemosyne 的竞品有哪些？跟 Notion 比怎么样？',
    groundTruth: '（知识库无相关内容，应拒答）',
    relevantKeywords: ['不存在', '无答案'],
  },
  {
    id: 'n004',
    category: 'no-answer',
    question: '团队有几个人？融资到哪一轮了？',
    groundTruth: '（知识库无相关内容，应拒答）',
    relevantKeywords: ['不存在', '无答案'],
  },
  {
    id: 'n005',
    category: 'no-answer',
    question: 'Mnemosyne 的服务器部署在哪个云上？用了哪些 CDN？',
    groundTruth: '（知识库无相关内容，应拒答）',
    relevantKeywords: ['不存在', '无答案'],
  },
  {
    id: 'n006',
    category: 'no-answer',
    question: '这个项目的 GitHub star 数多少？',
    groundTruth: '（知识库无相关内容，应拒答）',
    relevantKeywords: ['不存在', '无答案'],
  },
  {
    id: 'n007',
    category: 'no-answer',
    question: 'Mnemosyne 支持哪些语言？有国际化吗？',
    groundTruth: '（知识库无相关内容，应拒答）',
    relevantKeywords: ['不存在', '无答案'],
  },
  {
    id: 'n008',
    category: 'no-answer',
    question: '产品的 SLA 承诺是什么？可用性几个 9？',
    groundTruth: '（知识库无相关内容，应拒答）',
    relevantKeywords: ['不存在', '无答案'],
  },
  {
    id: 'n009',
    category: 'no-answer',
    question: 'Mnemosyne 的数据备份策略是什么？',
    groundTruth: '（知识库无相关内容，应拒答）',
    relevantKeywords: ['不存在', '无答案'],
  },
  {
    id: 'n010',
    category: 'no-answer',
    question: '客服怎么联系？有工单系统吗？',
    groundTruth: '（知识库无相关内容，应拒答）',
    relevantKeywords: ['不存在', '无答案'],
  },

  // === 跨时间关联（5 条）===
  {
    id: 't001',
    category: 'cross-time',
    question: '我之前写的零信任登录和后来写的 MCP Server 有什么共同的安全理念？',
    groundTruth: '都遵循"服务端不见明文"原则：登录不传 masterKey，MCP 不解密笔记',
    relevantKeywords: ['零信任', 'MCP', 'masterKey', '明文'],
  },
  {
    id: 't002',
    category: 'cross-time',
    question: '从助记词到向量检索，整个数据链路是怎么保证安全的？',
    groundTruth: '助记词派生masterKey→masterKey加密笔记→同步只传密文→检索在客户端解密后做cosine',
    relevantKeywords: ['助记词', 'masterKey', '加密', 'cosine', '客户端'],
  },
  {
    id: 't003',
    category: 'cross-time',
    question: '我修复维度不匹配 bug 的思路和修复助记词校验的思路有什么共同点？',
    groundTruth: '都是"错误信息要指向真正原因"：checksum 检出顺序错，model filter 避免维度混用',
    relevantKeywords: ['checksum', 'model', 'filter', '错误信息'],
  },
  {
    id: 't004',
    category: 'cross-time',
    question: 'Agent 的双链提议和飞书捕获的 AI 总结，都是 AI 干什么活？',
    groundTruth: '都是"AI 提议/整理"而非"AI 替代"：双链提议需用户接受，AI 总结写 inbox 待用户消费',
    relevantKeywords: ['Agent', '提议', '飞书', 'inbox', 'AI'],
  },
  {
    id: 't005',
    category: 'cross-time',
    question: 'local-first 架构在登录、同步、检索三个环节分别体现在哪？',
    groundTruth: '登录masterKey不出客户端，同步本地是真理之源，检索在客户端IndexedDB做cosine',
    relevantKeywords: ['local-first', 'masterKey', '同步', 'IndexedDB', 'cosine'],
  },
];

// 按类别统计
export const TEST_SET_STATS = {
  total: TEST_SET.length,
  factual: TEST_SET.filter((s) => s.category === 'factual').length,
  synthesis: TEST_SET.filter((s) => s.category === 'synthesis').length,
  'no-answer': TEST_SET.filter((s) => s.category === 'no-answer').length,
  'cross-time': TEST_SET.filter((s) => s.category === 'cross-time').length,
};
