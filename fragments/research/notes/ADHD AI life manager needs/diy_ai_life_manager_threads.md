# DIY "AI, manage my life" setups: requests, architectures, failure points

**Method and access caveat (read first).** Research date 2026-10-29. In this session the network blocked every direct page fetch: reddit.com / old.reddit.com / .json endpoints (proxy 403, and the search tool refuses reddit.com as a domain), Reddit mirrors (arctic-shift, pullpush), news.ycombinator.com, hn.algolia.com, all substack.com subdomains, community.openai.com and iwoszapar.com (DNS blocked). The only working tool was a web search engine that returns titles, URLs and summarized snippets. So:
- Text marked **[snippet quote]** is wording that appeared in quotes or verbatim in the search engine's snippet for that URL. It is probably verbatim from the page but **was not checked against the page itself**. Re-verify before publishing.
- Text marked **[paraphrase]** is the search engine's summary of the page, not the author's words.
- No usernames could be captured. No Reddit comment text could be retrieved at all.
- To get the requested Reddit and HN verbatim quotes, the session's network settings need to allow reddit.com, old.reddit.com, news.ycombinator.com, hn.algolia.com, *.substack.com and community.openai.com.

---

## Q1. The target thread: r/ClaudeAI "Looking for an AI system to basically manage my…" (1te6yj4)

### Takeaway
I could not fetch the thread. It was blocked through www.reddit.com, old.reddit.com, the .json endpoint and Reddit archive mirrors, and an exact-title web search returned no copy or index of it. Nothing about its post or comments is reported here. Below are the closest sources the search tool could reach.

### Cited Findings
- Exact-title search ("Looking for an AI system to basically manage my" ClaudeAI) returned no Reddit hit. The closest results were guides for Claude Projects and Claude Code used as a personal assistant — [search result: Michael Crist, "How I Built My Personal AI Assistant (Claude Code Tutorial)"](https://michaelcrist.substack.com/p/personal-ai-assistant); [Technically Curious, "Create your personal agent with Claude"](https://technicallycurious.substack.com/p/create-your-personal-agent-with-claude)
- [paraphrase] One Claude Code personal-assistant guide's setup is "two notes, two folders, one memory file, and three commands", and the memory file "keeps context from one day to the next" — [AI Maker, Claude Code guide starter template](https://aimaker.substack.com/p/claude-code-guide-starter-template) (from the search summary; which of the two guides it belongs to is uncertain)
- [paraphrase] A guide says Claude's built-in connectors are "limited", so it recommends a third-party connector (Composio's Rube) for email and calendar. It also recommends conservative permissions (draft emails, don't send them) and warns about prompt injection — [Technically Curious](https://technicallycurious.substack.com/p/create-your-personal-agent-with-claude)
- [paraphrase] An ADHD Substack writer built a "Chief of Staff" in Claude Code that holds clients, deadlines and ideas. "It isn't connected to anything; it's a view on a local computer". The writer copies updates back into Claude, and Claude Code then edits the files — [Both Are True, "let's talk about ai, baby"](https://botharetrue.substack.com/p/lets-talk-about-ai-baby)

### Inferences
- The "Chief of Staff" setup is a good example of a typical DIY approach: a local view, then manual copy-paste into Claude, then Claude edits files. Capture and sync are still manual. That is the gap a capture-first product like Fragments addresses.

### Gaps
- The OP's text, the commenters' recommendations and warnings, and the thread's date. All of these need reddit.com access. The ID prefix 1te… suggests a 2026 post, but that is unconfirmed.

---

## Q2. Similar threads and discussions (Reddit / HN / forums)

### Takeaway
Reddit was unreachable. Hacker News has many relevant threads, and I found about 12 through search. Read together, they show people moving from "chatbot + to-do app" toward always-on self-hosted agents (Clawdbot → Moltbot → OpenClaw, Hermes) that message them first on WhatsApp or Telegram. The same complaints recur: unreliable scheduling, cost, and too much data entry.

### Cited Findings (thread list, with what the snippet showed)
1. **"Scheduled tasks in ChatGPT"** (HN, Jan 2025). [paraphrase] A user's daily reminder task "failed with no explanation". When asked why, ChatGPT said they had too many tasks, but they had only one. [snippet quote] "95% tasks failed and I get a ton of emails about it." Others called it unreliable compared with a normal reminder app — [HN 42716356](https://news.ycombinator.com/item?id=42716356)
2. **"Ask HN: Who is using OpenClaw?"** (2026). [snippet quote] Uses: "to-do lists (bill, birthday, event reminders)", "nudge me about todos in my obsidian", "a morning debriefer that could scan my google calendar, trello board, and gmail". Failure: OpenClaw "quickly got confused about the cron tasks it had" — [HN 47783940](https://news.ycombinator.com/item?id=47783940)
3. **"Clawdbot – open source personal AI assistant"** (HN, ~Jan 2026). [paraphrase] One user manages "a TODO list in Apple Notes to keep them on task". Another planned to hook it to Apple Reminders/Jira/Linear/Slack so it would flag and reschedule overdue items. Someone else cloned it mainly for its WhatsApp support. One warning: don't run it on a metered API plan because of cost — [HN 46760237](https://news.ycombinator.com/item?id=46760237)
4. **"Ask HN: What is your (AI) dev tech stack / workflow?"** (2026). [snippet quote] "Hermes basically rules my personal life at this point - it is a _very_ useful personal assistant" — [HN 48413629](https://news.ycombinator.com/item?id=48413629)
5. **"Show HN: AI that can use Gmail, SMS, Slack, Calendar" (Martin)** (late 2024). [paraphrase] Sets reminders, tracks to-dos, sends daily briefings. A commenter uses it "to manage my todo list while i'm coding" — [HN 42247133](https://news.ycombinator.com/item?id=42247133)
6. **Emilia (family and friends knowledge plus reminders)**. [snippet quote] The creator says "the amount of work to input all this data still bothers me" — [HN 44420716](https://news.ycombinator.com/item?id=44420716)
7. **"Launch HN: Indy (YC S21)"** (Shimmer, ADHD; ~Jan 2026). [paraphrase] The founders say the hardest problem was keeping the AI from "collapsing into generic advice, productivity pressure, or over-automation/reliance". Indy is deliberately not a to-do list because lists overwhelm people. A commenter argued that without the power to enforce consequences, LLMs are no better than "overcomplicated to-do lists" for ADHD — [HN 46648144](https://news.ycombinator.com/item?id=46648144); [Product Hunt: "AI support for your ADHD, not just your to-do list"](https://www.producthunt.com/products/indy-your-adhd-copilot)
8. **"Ask HN: ADHD"** (2026). [paraphrase] One commenter suggests an AI assistant as a low-cost substitute for a human helper. Another says a reliable capture-and-triage system matters more than which tool you use — [HN 46610156](https://news.ycombinator.com/item?id=46610156)
9. **Recent HN comment (ADHD + agent)**. [paraphrase] An ADHD commenter says the agent's reminders and "gentle nudges" help, but warns against autonomous agents sending messages without oversight — [HN 49991273](https://news.ycombinator.com/item?id=49991273)
10. **"Show HN: I built an AI tool to help with ADHD task paralysis"** (2024). [paraphrase] Breaks tasks into steps and adds timers and music. The creator floated nudging users about tasks they keep avoiding — [HN 40350688](https://news.ycombinator.com/item?id=40350688)
11. **Goblin.tools discussion** (2025). [paraphrase] A commenter pays for Magic ToDo, the LLM task breakdown tool — [HN 43461375](https://news.ycombinator.com/item?id=43461375)
12. **"Show HN: RemindMe"** — [HN 45608356](https://news.ycombinator.com/item?id=45608356) (title only; no content retrieved)
13. **OpenAI forum: "ChatGPT Tasks … Broken"** (Jan 2025). [paraphrase] Scheduled tasks broke when the user deleted the chat that created them — [community.openai.com](https://community.openai.com/t/chatgpt-tasks-gpt-4o-with-scheduled-tasks-broken/1091150)
14. **OpenAI forum: "How can scheduled tasks work if gpt doesnt know the time?"** (2025). [paraphrase] A reminder failed, and ChatGPT explained it hadn't fired because "the time hasnt passed". Its sense of the current time was off by days — [community.openai.com](https://community.openai.com/t/how-can-scheduled-tasks-work-if-gpt-doesnt-know-the-time/1249316); also [“tasks feature failed to set a reminder even it arranged well”](https://community.openai.com/t/the-tasks-feature-failed-to-set-a-reminder-even-it-arranged-well/1139442)
- Older baseline threads: [Ask HN: What tools do you use to manage your life?](https://news.ycombinator.com/item?id=14799300), [Ask HN: How do you manage personal+work projects/tasks?](https://news.ycombinator.com/item?id=40478212), [Ask HN: I'd like to hire a personal/executive assistant](https://news.ycombinator.com/item?id=29336234). [paraphrase] Several commenters still rely on "Hey Siri, set a reminder for 7pm tomorrow…" for hard deadlines — [search summary across these threads](https://news.ycombinator.com/item?id=28979602)

### Inferences
- In 2026 the most visible DIY trend is self-hosted, chat-app-native agents (OpenClaw, Hermes), not Claude Projects. Their pull comes from being able to *message you first* on channels you already check.
- ADHD-specific products (Indy) are dropping lists entirely. That supports Fragments' "calm Today view" over a full task backlog.

### Gaps
- None of the requested subreddits (r/ClaudeAI, r/ChatGPT, r/ChatGPTPro, r/productivity, r/ObsidianMD, r/Notion, r/selfhosted, r/PKMS) could be searched or read.

---

## Q3. DIY architectures people build, and what works

### Takeaway
I found five recurring setups: (a) Claude Code/Obsidian vaults with a CLAUDE.md memory file, (b) Claude or ChatGPT plus an MCP or connector to Todoist or Calendar, (c) ChatGPT Tasks, (d) n8n/Zapier Telegram bots with Whisper voice capture into Todoist and Calendar, and (e) always-on agents (OpenClaw, Hermes) with cron "heartbeats". What reliably works is LLM *triage and structuring* of brain dumps and *daily briefings*. Storage, scheduling and push have to come from somewhere else.

### Cited Findings
**(a) Memory-file second brains (Claude Code + Obsidian/markdown)**
- [snippet quote] "The single highest-value thing I did was create a CLAUDE.md file at the root of my vault. This file loads automatically every session." Memory is layered: always-read orientation notes plus an archive that "only gets opened when a specific question requires it" — [Noah, "How to Build Your AI Second Brain Using Obsidian + Claude Code"](https://noahvnct.substack.com/p/how-to-build-your-ai-second-brain)
- [snippet quote] "Every interruption that used to cost 30 minutes of reconstruction now costs about 60 seconds." This is one author's own claim from an ADHD framing — [Iwo Szapar, "Claude Code for ADHD: Outsourcing Executive Function to AI"](https://www.iwoszapar.com/p/claude-code-adhd-executive-function)
- [snippet quote] "Instead of storing context inside a specific tool or a proprietary memory system, you keep everything as plain markdown files in a structured folder" (portable across Claude, Codex and Hermes) — [MindStudio](https://www.mindstudio.ai/blog/portable-ai-second-brain-claude-codex-hermes)
- [snippet quote] "Claude Projects are the right tool for a bounded, stable workspace", as opposed to a cross-project memory that updates itself — [Locul, "Claude Projects vs a Living Second Brain"](https://locul.ai/blog/claude-projects-vs-second-brain) (vendor)
- Further examples: [Medium, "I Built a Persistent Memory System for Claude Using Obsidian"](https://medium.com/@jclopez117/i-built-a-persistent-memory-system-for-claude-using-obsidian-second-brain-22d4eeeb361b); [Medium, "How I Built a Second Brain for Claude Code"](https://medium.com/@sequierh/how-i-built-a-second-brain-for-claude-code-b49b3104b386); [Adelaida Diaz-Roa, "How I Built a Second Brain That Actually Works With AI"](https://adelaidadiazroa.substack.com/p/how-i-built-a-second-brain-that-actually)

**(b) Claude + MCP/connectors to Todoist / Google Calendar**
- Todoist has an official Claude integration — [Geeky Gadgets](https://www.geeky-gadgets.com/todoist-official-claude-integration/). There is also a community MCP server for "natural language task and project management with bulk operations" — [greirson/mcp-todoist](https://github.com/greirson/mcp-todoist)
- [snippet quote] Todoist API: "Availability of reminders functionality is dependent on the current user plan." [paraphrase] The MCP's reminder tools fail on free accounts, and "one TODOIST_API_TOKEN equals full account access — no read-only mode, no per-project scope" — [Todoist API docs](https://developer.todoist.com/api/v1/); [MCP.Directory Todoist guide 2026](https://mcp.directory/blog/todoist-mcp-complete-guide-2026)
- [paraphrase] One user found the Google Calendar connector could read events but couldn't access or update Google Tasks — [Carly, "Using Claude for a To-Do List" (2026)](https://www.usecarly.com/blog/claude-todo-list/) (vendor)
- A YouTube summary describes connecting Todoist to Claude as a "game changer" — [Recall summary, "I connected Todoist with Claude"](https://www.recall.it/summary/tool-finder/i-connected-todoist-with-claude-game-changer)

**(c) ChatGPT Tasks**
- Launched in beta in Jan 2025 with a limit of 10 active tasks — [AlternativeTo news](https://alternativeto.net/news/2025/1/openai-now-allows-you-to-schedule-reminders-and-to-dos-in-chatgpt-with-a-new-tasks-feature); [TechRadar](https://www.techradar.com/computing/artificial-intelligence/chatgpt-tasks-can-start-taking-over-your-calendar-and-remind-you-to-finish-your-to-do-list)
- [paraphrase] Tom's Guide's reviewer found recurring reminders worked, but a timed dinner-list request returned advice instead of the list. Conclusion: "sticking with Siri for now" — [Tom's Guide](https://www.tomsguide.com/ai/i-tried-chatgpt-tasks-and-im-sticking-with-siri-for-now-heres-why); see also ["I tried replacing Todoist with ChatGPT Tasks"](https://tech.yahoo.com/general/articles/tried-replacing-todoist-chatgpt-tasks-113013089.html)

**(d) n8n / Telegram / Whisper pipelines**
- [paraphrase] The typical build: Telegram Trigger, then a Switch node (voice or text), then Whisper or Groq transcription, then an AI Agent with memory, then Todoist/Calendar tools. Setup needs BotFather plus API keys plus chat IDs. One template "checks live data before assuming an action (create, update, delete) succeeded" and sends daily briefings — [n8n template 16833 (OpenRouter + GCal + Todoist)](https://n8n.io/workflows/16833-run-a-telegram-productivity-assistant-with-openrouter-google-calendar-and-todoist); [n8n 9981](https://n8n.io/workflows/9981-voice-and-text-telegram-assistant-with-gpt-41-mini-and-conversation-memory/); [n8n 17231](https://n8n.io/workflows/17231-run-a-telegram-voice-assistant-with-openai-gpt-5-mini-and-google-calendar); [n8n 8582 multi-agent Gemini](https://n8n.io/workflows/8582-personal-assistant-bot-with-multi-agent-system-using-telegram-and-google-gemini/); [Futurise: Telegram voice → Todoist](https://futurise.com/template/convert-telegram-voice-to-todoist-tasks-1103); [GitHub j-shifat-18/Personal_Ai_Assistant](https://github.com/j-shifat-18/Personal_Ai_Assistant); [Medium: Personal AI Assistant on Telegram using n8n](https://medium.com/@balakrishnan.devops/personal-ai-assistant-on-telegram-using-n8n-ed0747519dd4)

**(e) Always-on agents (OpenClaw, formerly Clawdbot/Moltbot; Hermes)**
- First published as Warelay in Nov 2025, later renamed Clawdbot, then Moltbot, then OpenClaw — [Wikipedia](https://en.wikipedia.org/wiki/OpenClaw)
- [paraphrase] It can proactively "ping" the user with morning briefings and reminders over WhatsApp, Telegram, Slack or Discord. Apple Notes and Reminders are supported through macOS skills — [Make Tech Easier](https://www.maketecheasier.com/self-hosted-clawdbot-ai-assistant/); [DataCamp](https://www.datacamp.com/tutorial/moltbot-clawdbot-tutorial)
- [paraphrase] Without markdown memory files read at the start of each session, "every conversation starts from zero" — [tekhead.it, "5 Things Running an OpenClaw Personal AI Agent Taught Me" (Feb 2026)](https://tekhead.it/blog/2026/02/5-things-running-an-openclaw-personal-ai-agent-taught-me-the-hard-way/)

**What works (across setups)**
- [paraphrase] Brain dump first, then ask the AI to sort it. The AI acts as external working memory. [snippet quote] "Holding twelve open loops in a working memory built for about four is the actual problem — not laziness, capacity." — [Built for ADHD prompts](https://www.builtforadhd.com/tools/chatgpt-prompts-for-adhd); [Things + AI: How I Actually Process My ADHD Brain Dumps (Medium)](https://medium.com/@jonwiggens_50984/things-ai-how-i-actually-process-my-adhd-brain-dumps-270a1e354861); [daklife](https://daklife.substack.com/p/chatgpt-adhd-brain-freeze)
- [paraphrase] Generic "plan my day" prompts gave vague output. Adding effort estimates, energy patterns and fallback plans improved them — [Plain English, "Why Your To-Do List Prompts Don't Work"](https://ai.plainenglish.io/why-your-to-do-list-prompts-dont-work-and-what-actually-gets-claude-to-plan-your-day-45bdac9cbc62)

### Inferences
- Every working DIY stack bolts four separate layers together: capture (Telegram voice or chat), structuring (LLM), a durable store (Todoist, Obsidian, markdown) and a scheduler/push (cron, Todoist reminders, Siri). Fragments' pitch is that one product owns all four.
- Voice capture over a messaging app is the de facto DIY mobile capture path. I found no DIY setup with watch capture.

### Gaps
- No first-hand Reddit reports on Apple Shortcuts + LLM pipelines or custom GPTs for life management could be retrieved.

---

## Q4. Where DIY setups break

### Takeaway
The failures that come up most are: no proactive push or reliable scheduling (ChatGPT Tasks misfires, the model doesn't know the time), statelessness and memory loss across chats, runaway cost from always-on agent heartbeats, too much data entry and maintenance, all-or-nothing permissions and trust in autonomous actions, and AI drifting into generic advice.

### Cited Findings
- **No reminders or persistence in chat assistants.** [snippet quote] "Reopen Claude tomorrow and you're pasting yesterday's list back in to continue. Claude reasons about tasks; it doesn't store them." It "doesn't have the ability to send you reminders, track deadlines over time, or follow up proactively". [paraphrase] Claude's scheduled tasks run only while the computer is awake and the app is open — [Carly blog (vendor, 2026)](https://www.usecarly.com/blog/claude-todo-list/); [Carly, Claude task management](https://www.usecarly.com/blog/claude-task-management)
- **Scheduler unreliability and hallucinated explanations.** [snippet quote] "95% tasks failed and I get a ton of emails about it". [paraphrase] ChatGPT said "too many tasks" when the user had one — [HN 42716356](https://news.ycombinator.com/item?id=42716356). [paraphrase] It got the wrong current time, so a reminder never fired — [OpenAI forum](https://community.openai.com/t/how-can-scheduled-tasks-work-if-gpt-doesnt-know-the-time/1249316). Deleting the source chat killed its tasks — [OpenAI forum](https://community.openai.com/t/chatgpt-tasks-gpt-4o-with-scheduled-tasks-broken/1091150). A third-party blog claims "Ask ChatGPT to remind you daily" doesn't work — [yougot.ai](https://www.yougot.ai/blog/ai-search/chatgpt-reminders/ask-chatgpt-to-remind-me-daily) (vendor)
- **Agent cron confusion.** [snippet quote] OpenClaw "quickly got confused about the cron tasks it had" — [HN 47783940](https://news.ycombinator.com/item?id=47783940)
- **Cost of always-on.** [snippet quote] "its important to know that @openclaw cron jobs use tokens. even if they do nothing." — [Chrys Bader on X](https://x.com/chrysb/status/2032562442937815510). [snippet quote] "kept seeing rows of HEARTBEAT_OK outputs… burning through credits just to say nothing happened". [snippet quote] "when Google rate-limited Gemini… the system silently fell back to Opus, Anthropic's most expensive model" — [tekhead.it (Feb 2026)](https://tekhead.it/blog/2026/02/5-things-running-an-openclaw-personal-ai-agent-taught-me-the-hard-way/). Estimates of about $128/month and about $345/month for a single 5-minute cron job — [LobsterFarm guide](https://www.lobsterfarm.ai/guides/reduce-api-costs/) (vendor-ish). Headline: "I tried OpenClaw, the 'free' AI agent. It cost me $500." — [DEV Community](https://dev.to/thegdsks/i-tried-the-free-ai-agent-with-124k-github-stars-heres-my-500-reality-check-2885). An HN commenter warned against running it on a metered API plan — [HN 46760237](https://news.ycombinator.com/item?id=46760237)
- **Manual copy-paste and data entry.** [paraphrase] The Chief of Staff setup "isn't connected to anything", so updates are copied in by hand — [Both Are True](https://botharetrue.substack.com/p/lets-talk-about-ai-baby). [snippet quote] "the amount of work to input all this data still bothers me" — [HN 44420716](https://news.ycombinator.com/item?id=44420716)
- **Long-chat context drift (an ADHD-specific pain).** [snippet quote] LLMs "tend to forget the entire conversation and stick to the latest stuff". The writer's workaround is an artifact-based tracking prompt — [Brian B. Carter](https://brianbcarter.substack.com/p/problem-do-you-get-lost-in-too-many). [paraphrase] An "I have ADHD" instruction to Claude reduces verbosity, but the effect fades over long sessions — [HN 49610631](https://news.ycombinator.com/item?id=49610631)
- **Permissions and trust.** [snippet quote] "one TODOIST_API_TOKEN equals full account access — no read-only mode, no per-project scope" — [MCP.Directory](https://mcp.directory/blog/todoist-mcp-complete-guide-2026). [paraphrase] One commenter warns about agents sending messages without oversight — [HN 49991273](https://news.ycombinator.com/item?id=49991273). [paraphrase] Another guide recommends drafting rather than sending, and flags prompt injection — [Technically Curious](https://technicallycurious.substack.com/p/create-your-personal-agent-with-claude)
- **Feature gating and connector gaps.** Todoist reminders need a paid plan — [Todoist API](https://developer.todoist.com/api/v1/). The Calendar connector can't touch Google Tasks — [Carly](https://www.usecarly.com/blog/claude-todo-list/)
- **Maintenance overhead.** n8n bots need BotFather, API keys, chat IDs and per-user project names — [n8n templates](https://n8n.io/workflows/16833-run-a-telegram-productivity-assistant-with-openrouter-google-calendar-and-todoist)
- **Generic or pressuring AI.** [paraphrase] Indy's founders struggled with the AI "collapsing into generic advice, productivity pressure, or over-automation/reliance" — [HN 46648144](https://news.ycombinator.com/item?id=46648144). [paraphrase] A clinician warns against over-reliance on technology instead of building skills — [Tom's Guide, AI for ADHD](https://tomsguide.com/ai/top-7-ways-ai-can-help-manage-your-adhd)

### Inferences
- The scheduling failures are architectural: the LLM is being used as the clock. A product that schedules deterministically and uses the LLM only for parsing and wording would remove both the hallucinated dates and the token-burning heartbeats.
- Silent failure is the worst outcome for ADHD users. A reminder that never fires breaks trust in the whole system.

### Gaps
- Latency complaints and lack of watch capture are not documented in what I could retrieve, though they are plausible. Hallucinated *dates while parsing* a brain dump, as distinct from the model not knowing the current time, were not documented.

---

## Q5. What people would pay for and repeatedly request

### Takeaway
Direct willingness-to-pay data is thin. Revealed preferences are clearer. People already pay for Magic ToDo, Todoist Pro (reminders), API bills of hundreds of dollars a month for OpenClaw, $49/month for hosted OpenClaw, and $25/hour for human body doubling. The repeated requests are proactive nudges and check-ins, morning briefings, voice capture, memory that persists, and gentle accountability without pressure.

### Cited Findings
- [paraphrase] A commenter pays for Goblin.tools Magic ToDo — [HN 43461375](https://news.ycombinator.com/item?id=43461375)
- [paraphrase] A hosted OpenClaw sells for $49/month — [getopenclaw.ai](https://www.getopenclaw.ai/blog/openclaw-vs-hermes-agent) (promotional)
- [snippet quote] "Body Doubling – $25/hour" (human VA service) — [ADHD Roadmap task assistants](https://adhdroadmap.coach/adhd-assistants/)
- [paraphrase] In a co-design study of 25 ADHD-affected professionals, participants preferred quiet, customizable check-ins over time-based triggers, and voice over text. They wanted "lightweight summaries, periodic check-ins and gentle accountability prompts" — [arXiv 2507.06864](https://arxiv.org/html/2507.06864)
- [paraphrase] Developers with ADHD wanted body-doubling partners who "check-in on them or offer task support". An AI body-double concept was rated M = 4.5 — [arXiv 2609.21254](https://arxiv.org/pdf/2609.21254)
- Title signal: "'Not Just Me and My To-Do List': … the Need for AI-Augmented Social Scaffolds" — [alphaXiv 2603.17258](https://www.alphaxiv.org/abs/2603.17258)
- Requested and loved features seen in the threads above: morning debrief across calendar, task board and email ([HN 47783940](https://news.ycombinator.com/item?id=47783940)); nudges about Obsidian or Apple Notes todos ([HN 46760237](https://news.ycombinator.com/item?id=46760237)); auto-flagging and rescheduling of overdue items ([HN 46760237](https://news.ycombinator.com/item?id=46760237)); proactive surfacing of forgotten tasks (Saner.AI's pitch — [Flown](https://flown.com/blog/adhd/ai-productivity-tools))

### Inferences
- The willingness to pay that shows up is mostly for proactivity: someone or something that checks in. Organization alone draws less. Fragments' reminders and nudges and its "does work" layer are where pricing power is likely to sit.

### Gaps
- No survey or thread with explicit price points for an ADHD AI life manager was found. Reddit "I'd pay $X for…" comments need reddit.com access.
