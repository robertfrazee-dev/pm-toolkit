# Evidence Base for Designing Digital Tools for Adults with ADHD (executive function, reminders, habits, engagement)

Context: informs "Fragments" (voice capture from watch/phone/web, AI auto-filing, calm Today view, reminders, streaks, end-of-day reset, "ask your brain", AI task breakdown).

Evidence labels used throughout:
- **[STRONG]** meta-analysis / systematic review / RCT
- **[MODERATE]** controlled lab studies, smaller trials, large observational datasets
- **[WEAK]** pilots, qualitative/diary studies, theses, preprints
- **[EXPERT]** clinical expert opinion, practitioner framing, secondary summaries
- **[UNVERIFIED]** vendor/blog claims not traced to primary source

Research note: arxiv.org was blocked in this session's network, so several 2025–2026 HCI preprints (scoping review of assistive tech for adults with ADHD, VR/AI body-doubling studies) could only be read via search snippets, not full text.

---

## Q1. Externalizing memory, time blindness, task initiation, implementation intentions, prospective memory, reminder timing/habituation, context-aware reminders, body doubling

### Takeaway
The best-supported foundations are (a) ADHD involves measurable timing deficits and time-based prospective-memory deficits, which is exactly where external cues help most, and (b) clinical CBT programs for adult ADHD that work are built around external aids (planners, lists, reminders). Barkley's "point of performance" principle is expert framing, not directly tested as an app design variable. Implementation intentions, body doubling, and context-aware reminders have promising but thin or child-only/non-ADHD evidence; reminder habituation evidence is mixed.

### Cited Findings

**Point of performance / externalizing information [EXPERT]**
- Barkley frames ADHD as a disorder of *performance* (doing what you know) rather than knowledge; interventions should modify the context where the action happens, and information should be moved "out of the brain and into the environment" — secondary summaries of Barkley's framework: [Simply Psychology](https://www.simplypsychology.org/can-you-have-adhd-and-be-organized.html); [ADD.org – Evidence for ADHD Coaching](https://add.org/the-evidence-for-adhd-coaching/) (describes "prosthetic environments" built around the individual).
- Placement matters: a phone medication reminder fails if pills are in the kitchen; the cue belongs where the action occurs — [ADD.org](https://add.org/the-evidence-for-adhd-coaching/); [Simply Psychology](https://www.simplypsychology.org/can-you-have-adhd-and-be-organized.html).
- Barkley's *Taking Charge of Adult ADHD* includes rules such as "Externalize Key Information" (table of contents only seen) — [buecher.de listing](https://buecher.de/artikel/buch/taking-charge-of-adult-adhd-second-edition/61996263).
- Ari Tuckman (expert): talk titled "Why Great Productivity Apps Aren't Enough" — tools must be paired with strategies — [ADD.org TADD 2022](https://add.org/tadd-2022-why-great-productivity-apps-arent-enough-with-ari-tuckman-psyd-cst/). In a podcast he stresses that reminder timing must account for "where am I going to be, when is the right time to set the reminder" and that a calendar entry only helps if you first knew what you needed to do — [Hacking Your ADHD podcast](https://pod.wave.co/podcast/hacking-your-adhd-b472f37f-d21e-4deb-b5d9-57b409bbf611/simple-isnt-easy-adhd-advice-youll-actually-use-w-dr-ari-tuckman) (transcript partly corrupted; treat as paraphrase).

**Clinical evidence that external aids are core to effective adult-ADHD treatment [STRONG for CBT package; component not isolated]**
- Safren's CBT program: first module is organization and planning (prioritized to-do lists, organizing papers/bills); a 2005 RCT pilot in medicated adults with residual symptoms found larger symptom reductions with CBT vs medication alone — [PMC3874265](https://pmc.ncbi.nlm.nih.gov/articles/PMC3874265). A larger RCT vs applied relaxation was published (JAMA 2010) per [APA Div 12](https://div12.org/?p=3134). The 2nd edition added optional use of smartphones/technology for organization — [Mastering Your Adult ADHD](https://campusstore.miamioh.edu/mastering-your-adult-adhd-steven-safren/bk/9780190235598).
- Solanto's meta-cognitive CBT targets time management, organization and planning and teaches external aids (planners, to-do lists, filing) — [NJ-ACT](https://nj-act.org/solanto.html); listed as an empirically supported treatment with AJP 2010 trial — [APA Div 12](https://div12.org/?p=8113).
- Gap noted: no RCT isolates the planner/reminder component (see Gaps).

**Time blindness [STRONG overall, thinner in adults]**
- Meta-analysis (Marx et al., 2021; 55 studies, all ages): "meta-analytic evidence of a broad range of timing deficits" in ADHD, including time estimation and production accuracy; reproduction deficits linked to attention and motivation — [Southampton ePrints](https://eprints.soton.ac.uk/456003); [EM-Consulte](https://www.em-consulte.com/article/1527936/meta-analysis-altered-perceptual-timing-abilities-).
- Adult-specific narrative review (Mette, 2023, IJERPH): adult studies are "very scarce"; adults with ADHD have problems estimating and reproducing intervals and managing time, but results are inconsistent across methods — [PMC9962130](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9962130/).
- Adult study: adults with ADHD impaired in time reproduction; proposed as a cognitive endophenotype — [Psychological Medicine](https://resolve.cambridge.org/core/journals/psychological-medicine/article/temporal-reproduction-and-its-neuroanatomical-correlates-in-adults-with-attention-deficit-hyperactivity-disorder-and-their-unaffected-firstdegree-relatives/9AF7D4EDAA163A77450E2879537ED711).

**Prospective memory (remembering to do things later) [MODERATE]**
- Adults with ADHD (n=25 vs 25) showed a large *time-based* PM deficit with no event-based difference — [PMC3590133](https://pmc.ncbi.nlm.nih.gov/articles/PMC3590133).
- Time-based tasks are thought to demand more executive control because there is no external cue to prompt retrieval — same source, [PMC3590133](https://pmc.ncbi.nlm.nih.gov/articles/PMC3590133).
- 2018 study (29 ADHD vs 24 controls): clear deficits in everyday PM, and everyday PM *mediated* the link between ADHD symptoms and procrastination — [ADHD Attention Deficit and Hyperactivity Disorders, Springer](https://link.springer.com/article/10.1007/s12402-018-0273-x).
- Event-based PM findings are mixed; a 2019 study (18 vs 18) found reduced PM across inhibitory-load conditions — [Mainz bibliography](https://bibliographie.ub.uni-mainz.de/en/catalog/publication-148568).
- No adult-ADHD PM meta-analysis found.

**Implementation intentions (if-then plans) [MODERATE in children; UNTESTED in ADHD adults]**
- Children with ADHD who formed if-then plans improved Go/No-Go inhibition to the level of non-ADHD children (Gawrilow & Gollwitzer) — [Uni Konstanz PDF](https://www.socmot.uni-konstanz.de/sites/default/files/08_Gawrilow_Gollwitzer_Implementation_intentions_facilit.pdf); [Konstanz summary](https://www.socmot.uni-konstanz.de/publications/implementation-intentions-facilitate-response-inhibition-adhd-children).
- If-then plans improved delay of gratification in inpatient children with ADHD — [BSL](https://mijn.bsl.nl/if-then-plans-benefit-delay-of-gratification-performance-in-chil/533398).
- APSARD research update notes the approach had not yet been tested in adults with ADHD — [APSARD](https://apsard.org/?p=4314).
- In healthy older adults, implementation intentions helped PM only for people who habitually used visual strategies — [ULiège handle](https://hdl.handle.net/2268/182649).

**Reminder timing, habituation, alert fatigue [MIXED]**
- Clinical decision support (Ancker et al., 2017): reminder acceptance dropped ~30% for each additional reminder per encounter; but no desensitization over time for a newly deployed alert. Repeat alerts for the same patient were the problem — [BMC Med Inform Decis Mak / PMC5387195](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5387195/).
- Same paper cites a trial-recruitment alert whose response fell ~2.7%/week (≈50%→35% over 36 weeks) — [PMC5387195](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5387195/).
- Micro-randomized trial (Drink Less app, Bell et al. 2023, JMIR mHealth): a notification increased the chance of opening the app in the next hour 3.5-fold; the effect did *not* significantly decline over time, and notification policy did not change time to disengagement — [DOAJ/JMIR mHealth](https://doaj.org/article/20ae0374687e46a4a4dfcd659b192528).
- Adult-ADHD-specific RCT (n=109): weekly SMS reminders increased logins within 48h in one module but did not change module completion or overall logins of a self-guided internet intervention — [Frontiers in Digital Health 2022](https://www.frontiersin.org/articles/10.3389/fdgth.2022.821031/text).

**Context-aware reminders (location/time) [EXPERT / WEAK]**
- Tuckman's emphasis on "where am I going to be" when setting reminders (see above) and Barkley's point-of-performance placement — [podcast](https://pod.wave.co/podcast/hacking-your-adhd-b472f37f-d21e-4deb-b5d9-57b409bbf611/simple-isnt-easy-adhd-advice-youll-actually-use-w-dr-ari-tuckman); [ADD.org](https://add.org/the-evidence-for-adhd-coaching/).
- Event-based PM (cue-triggered) appears less impaired than time-based PM in adults with ADHD — [PMC3590133](https://pmc.ncbi.nlm.nih.gov/articles/PMC3590133). (See inference below.)

**Body doubling [WEAK–MODERATE; mostly descriptive]**
- Eagle & Ringland (2024, ACM TACCESS 17(3)): survey of 220 (193 neurodivergent, mostly ADHD/autism); ~75% actively use body doubling, often before knowing the term; it serves goals beyond task completion (starting work, reduced isolation); friends/family most common doubles — [ACM DOI 10.1145/3689648](https://doi.org/10.1145/3689648); summary at [a11y-paradise](https://a11y-paradise.onrender.com/reviews/69cadb89affa4d2e79b788ae).
- Ara et al. (2025 preprint): VR study with 12 adults with ADHD comparing alone vs human body double vs AI body double — [arXiv 2509.12153](https://arxiv.org/html/2509.12153v1) (full text not accessible here).
- Field summaries describe earlier body-doubling studies as inconclusive, with one ADHD study finding no significant effect — via [arXiv 2509.12153](https://arxiv.org/html/2509.12153v1) snippets (not verified in full text).
- "Two's a Crowd: Human and AI-Based Copresence for Developers with ADHD" (preprint) — [arXiv 2609.21254](https://arxiv.org/pdf/2609.21254) (not read).
- FLOWN-linked survey of 117 users claiming focus gains is self-reported and from an interested company — [neurodiversity.org](https://neurodiversity.org/?p=11449) [UNVERIFIED].

**Task initiation / breaking tasks into steps [EXPERT]**
- Barkley's framework includes breaking tasks into small steps and externalizing time (timers, visible clocks) — [ADD.org](https://add.org/the-evidence-for-adhd-coaching/); [Simply Psychology](https://www.simplypsychology.org/can-you-have-adhd-and-be-organized.html).
- In a 2025 diary study, an adult with ADHD said structure helped most "when someone else prompted them," and ChatGPT provided similar prompting — [ACM DL 10.1145/3764687.3764713](https://dl.acm.org/doi/10.1145/3764687.3764713) [WEAK].

### Inferences
- Because time-based PM is the clearest deficit and event-based PM is relatively spared, Fragments should convert time-based intentions into event/context-based cues wherever possible (location arrival, "after you finish X", calendar transitions) — this is a reasoned inference, not directly tested in ADHD apps.
- Time blindness supports making time visible in the Today view (time remaining, how long things take) rather than only listing items.
- Reminder design should avoid repeated nagging for the same item (strongest habituation signal in the data came from repeated alerts per encounter), while a single well-timed nudge does reliably cause short-term action.
- AI task breakdown into a concrete first step plus an optional "if-then" plan aligns with implementation-intention mechanisms, but evidence in ADHD adults is extrapolated from children and non-ADHD populations.
- A lightweight "virtual co-presence" / AI body-double mode is plausible and user-endorsed but should be framed as experimental.

### Gaps
- No RCT isolating reminders/planners as a component in adult ADHD treatment.
- No implementation-intention RCT in adults with ADHD found.
- No study of location-based reminders specifically in ADHD.
- No primary Barkley text read directly (only secondary summaries); Russell Ramsay, Hallowell and CHADD primary statements were not retrieved in this search budget.
- Body-doubling efficacy in controlled studies remains unclear; arXiv full texts were inaccessible.

---

## Q2. Do streaks and gamification help or harm ADHD users? Forgiving streaks, variable rewards, novelty

### Takeaway
There is no peer-reviewed study of streaks/shame specifically in ADHD. Habit science (Lally 2010) shows a single missed day does not derail habit formation, which supports forgiving streaks; HCI work shows streaks can become the goal itself and drive fear-of-loss. ADHD reward research (delay aversion, steeper discounting) supports immediate feedback, but "all-or-nothing abandonment after streak loss" is a practitioner/blog claim, not established fact.

### Cited Findings
- Lally et al. (2010, UCL): missing one opportunity "did not materially affect the habit formation process," but very inconsistent performers did not form habits; median ~66 days to automaticity (range ~18–254) — [UCL news](https://www.ucl.ac.uk/news/2009/aug/how-long-does-it-take-form-habit); [James Clear summary](https://jamesclear.com/new-habit) [MODERATE; small sample, self-reported automaticity]. A replication preprint notes the original analytic sample was small and unreplicated — [PCI Registered Reports](https://rr.peercommunityin.org/download/t_recommendations.reply_pdf.8382af6b73bdd0f7.6d616e757363726970745f7072657072696e742e706466.pdf). Sample size reports conflict (39 vs 82 analyzed).
- Stawarz/UCL CHI 2016 LBW ("Don't Kick the Habit"): habit apps mostly do not support psychological "habit" construct; streaks can become the goal itself and some users were motivated by fear of losing a streak; also raises dependency on app reminders — [UCL Discovery PDF](https://discovery.ucl.ac.uk/1477627/1/Chi%202016%20LBW%202.1%20camera%20ready.pdf) [WEAK; small, non-ADHD].
- ADHD reward processing: children with ADHD prefer smaller immediate rewards; fMRI study found steeper delay discounting in ADHD supporting the delay-aversion account — [PMC8404726](https://pmc.ncbi.nlm.nih.gov/articles/PMC8404726/); [Springer J Abnorm Child Psychol](https://link.springer.com/article/10.1007/s10802-011-9547-x) [MODERATE; mostly children].
- Behavioral interventions should account for reduced waiting capacity beyond preference for immediate reward — [Mount Sinai scholars](https://scholars.mssm.edu/en/publications/waiting-and-working-for-rewards-attention-deficithyperactivity-di/).
- Claim that ADHD users with all-or-nothing thinking abandon apps after losing long streaks — [AFFiNE blog](https://affine.pro/blog/gamified-to-do-list-apps-adhd) [UNVERIFIED/EXPERT-opinion-level; cites unverifiable "Klarity Health research"].
- Gamification design commentary recommending forgiving mechanics (streak freezes, etc.) — [Yu-kai Chou, Streak Design](https://yukaichou.com/gamification-analysis/streak-design-gamification-motivation-burnout/) [EXPERT, gamification practitioner, not ADHD-specific].
- 2026 qualitative study of students using a habit app with streaks, rewards and pet progression (usability focus, not ADHD) — [Springer J Technol Behav Sci](https://link.springer.com/article/10.1007/s41347-026-00707-2) [WEAK].

### Inferences
- Design streaks as "consistency" metrics (e.g., X of last 7 days, weekly totals) or with automatic grace days, consistent with Lally's finding that one miss doesn't matter; avoid a zero-reset counter as the hero metric.
- Immediate, small feedback on completing a first step fits delay-aversion findings better than long-horizon rewards.
- End-of-day reset language should frame carry-over as neutral ("moved to tomorrow"), not as failure — inference from shame/all-or-nothing concerns, which are expert/anecdotal rather than measured.

### Gaps
- No peer-reviewed study of streak loss, shame, or rejection sensitivity in ADHD app users.
- No study found on variable rewards or novelty-rotation for ADHD engagement (novelty-seeking search returned nothing).
- CHADD/ADDitude/Hallowell statements on gamification not retrieved.

---

## Q3. Engagement and retention of ADHD and mental-health apps

### Takeaway
Real-world retention for mental-health apps is very low (median ~3.3% at day 30). Adult-ADHD digital interventions consistently report low adherence; reminders give only point-in-time bumps, financial incentives raised adoption, and no study shows a design pattern that reliably fixes long-term retention.

### Cited Findings
- Baumel et al. (2019, JMIR): 93 mental-health apps (median 100k installs), panel data; median 15-day retention 3.9% and 30-day retention 3.3%; peer-support (8.9%, n=2 apps), mindfulness (4.7%), and tracker apps (6.1%) retained better than breathing apps (0%) — [JMIR 2019;21(9):e14567](https://www.jmir.org/2019/9/E14567/); commentary noting real-world retention is routinely lower than in trials — [The Mental Elf](https://www.nationalelfservice.net/mental-health/digital-mental-health-tool-ignore-trial-read-analytics/) [MODERATE, large observational].
- Self-guided internet interventions for adult ADHD face low adherence; RCT of weekly SMS reminders (n=109) only increased short-term logins — [Frontiers in Digital Health 2022](https://www.frontiersin.org/articles/10.3389/fdgth.2022.821031/text) [STRONG for that narrow question].
- FOCUS ADHD app 3-arm trial (n=73 adults): app alone did not improve medication adherence; adding a medication discount yielded 100% vs 75% adoption and more logging — [European Psychiatry 2023 / DOAJ](https://doaj.org/article/5174c516408441c5836c4981106ef96f) [MODERATE].
- Adult ADHD App (Ireland) audit: >18,000 downloads, ~12,000 active users, 53% returning (usage audit, no outcomes) — [UCD repository](https://researchrepository.ucd.ie/entities/publication/5cd4ecb2-f706-401d-8f95-b7207fe40518) [WEAK].
- NUMO app (adults): symptom reduction reported; authors suggest continuous engagement needed — [BPA 2024](https://bpa.giuntipsy.com/?p=13941) [WEAK, non-randomized].
- Systematic review of ADHD apps (Hosseinnia et al., 2025; 14 studies to May 2024): mostly child/adolescent targets; apps "can potentially be adjunctive instruments" — [PMC11904913](https://pmc.ncbi.nlm.nih.gov/articles/PMC11904913/) [STRONG review, weak underlying studies].
- App-store scoping review (2013–2023): 46 apps analyzed from 3,474; only 2 of 35 commercial apps had medical endorsement — [Frontiers in Public Health 2025](https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2025.1483923/full).
- UK adult review (Bosnic et al., 2024): 13 peer-reviewed interventions and 10 commercial apps — [Strathprints](https://strathprints.strath.ac.uk/id/eprint/89559).
- 2026 scoping review of digital health technologies for adults with ADHD: 133 studies to Dec 2025, with risk-of-bias analysis — [Frontiers in Digital Health 2026](https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2026.1746732/full).
- Notification micro-randomized trial: notifications reliably triggered short-term opens but different policies didn't change time to disengagement; "further optimisation is required for longer-term engagement" — [JMIR mHealth 2023 / DOAJ](https://doaj.org/article/20ae0374687e46a4a4dfcd659b192528).

### Inferences
- Benchmark expectations: a "good" ADHD life-manager app should be judged against a ~3–6% day-30 baseline for mental-health/tracker apps; tracker-type apps do somewhat better.
- Since reminders produce short-lived bumps, retention must come from intrinsic utility (capture is faster than alternatives; the app reliably "remembers") rather than nudges.
- Peer/social elements correlated with higher retention in Baumel (tiny n), loosely supporting optional body-doubling/social features.

### Gaps
- No published 30-day retention benchmark specific to ADHD productivity apps.
- No RCT comparing specific engagement features (streaks, AI coaching, social) in ADHD adults.

---

## Q4. Voice capture and wearables (smartwatch prompts) for ADHD

### Takeaway
Evidence is thin: wrist-based prompting is feasible and well received (pilot in children, thesis in adults), and voice-captured reminders are studied mainly in older adults/MCI. No empirical HCI study of voice capture by adults with ADHD was found.

### Cited Findings
- Revibe Connect open-label pilot (children): wearable vibration prompts for self-monitoring attention were feasible with reported functional improvements — [Brain Sciences/MDPI 2023](https://www.mdpi.com/2076-3425/13/12/1728) [WEAK; no control].
- Chalmers master's thesis (adults with ADHD): smartwatches can be tailored with customizable notifications, alarms, timers, reminders and quick voice notes aligned to routines; setup help and trial periods aid adoption — [Chalmers ODR](https://odr.chalmers.se/items/b2823e79-9286-446c-8a53-2f7219fc0b45/full) [WEAK].
- Voice assistants & speech recognition: Alexa recognition accuracy in 83 older adults varied with voice quality and pause ratio, suggesting ASR may underperform for atypical speech patterns — [arXiv 2602.23436](https://arxiv.org/abs/2602.23436) [WEAK, non-ADHD].
- Voice-activated assistant tip card for older adults' prospective-memory reminders reported adoption barriers — [Gerontechnology 2024](https://journal.gerontechnology.org/currentIssueContent.aspx?aid=3372) [WEAK, non-ADHD].
- Conceptual voice-enabled productivity assistant for ADHD professionals (framework, not user study) — [alphaXiv 2507.06864](https://alphaxiv.org/overview/2507.06864v1).
- Unverified claims: a study of 706 children with smartwatch coaching reminders (+25 min attention, +19% on-task) — [AFFiNE blog](https://affine.pro/blog/smartwatch-planner-integration-adhd) [UNVERIFIED; original not located].

### Inferences
- Voice capture from the watch directly addresses the "point of performance" principle (capture when/where the thought occurs) and reduces the effortful step of opening an app — reasoned, not tested.
- Watch haptics may be less intrusive than phone notifications, but no evidence on habituation to wrist prompts was found.
- ASR robustness to rambling, fragmented, or paused speech matters; build tolerant parsing and easy correction.

### Gaps
- No controlled study of smartwatch reminders in adults with ADHD.
- No HCI study (CHI/ASSETS) found on voice capture for ADHD adults.

---

## Q5. Risks: over-reliance on AI, privacy of sensitive data, trust in automated organization (automation bias, transparency, undo)

### Takeaway
Adults with ADHD already use ChatGPT for executive-function and emotional support (qualitative evidence), but no controlled trials exist. General automation-bias research shows over-trust is common, explanations can backfire, and verification friction reduces over-reliance but is disliked. Mental-health apps have a documented poor privacy track record. No research specifically on undo was found.

### Cited Findings
- Diary + interview study (13 adults with ADHD, 7 days, 2025, ACM): ChatGPT used to support executive function, emotional regulation, and bridging neurotypical/neurodivergent communication; described as "a little bit of a life raft" — [ACM DL 10.1145/3764687.3764713](https://dl.acm.org/doi/10.1145/3764687.3764713) [WEAK, qualitative].
- ChatGPT-generated EF rehabilitation plans for hypothetical ADHD profiles needed further development for accuracy, personalization, feasibility — [PubMed 41345900 (BMC Psychology 2025)](https://pubmed.ncbi.nlm.nih.gov/41345900/) [WEAK].
- OT commentary: AI may support time management, organization, attention, emotional regulation for adults with ADHD (largely anecdotal) — [Occupational Therapy Now, Apr 2025](https://mydigitalpublication.com/publication/?i=845086&article_id=4969679&view=articleBrowser) [EXPERT].
- Automation bias review (Romeo & Conti, 2025, AI & Society): automation bias shaped by cognitive, attitudinal and task factors; overly technical or simplistic explanations may reinforce misplaced trust; increased verification effort reduces complacency — [Springer AI & Society](https://link.springer.com/article/10.1007/s00146-025-02422-7) [STRONG review, general population].
- Explanations helped low-familiarity users but induced automation bias in high-familiarity users — [arXiv 2005.02335](https://arxiv.org/pdf/2005.02335) [MODERATE].
- Cognitive forcing functions (Buçinca et al., 2021, cited in the review): designs that reduced over-reliance most received the least favorable user ratings — via [Romeo & Conti 2025](https://link.springer.com/article/10.1007/s00146-025-02422-7).
- Mozilla *Privacy Not Included* (2023): of 32 mental-health apps, 19 still carried warning labels and ~40% got worse year over year; 2022 edition called mental-health/prayer apps the worst category Mozilla had reviewed — [Mozilla Foundation](https://www.mozillafoundation.org/en/blog/shady-mental-health-apps-inch-toward-privacy-and-security-improvements-but-many-still-siphon-personal-data/); [Mozilla 2023 check-in](https://www.mozillafoundation.org/nl/privacynotincluded/articles/are-mental-health-apps-better-or-worse-at-privacy-in-2023/). Note: secondary outlets report conflicting baseline counts (23 vs 29 of 32 in 2022) — e.g., [Becker's](https://www.beckershospitalreview.com/?p=199600).
- 2016 CHI LBW warns habit apps can create dependency on app reminders rather than building internal habits — [UCL Discovery](https://discovery.ucl.ac.uk/1477627/1/Chi%202016%20LBW%202.1%20camera%20ready.pdf).

### Inferences
- Auto-filing should be visible and reversible: show where a fragment went and why (briefly), allow one-tap move/undo, and surface low-confidence filings for review — derived from automation-bias literature; undo itself is unstudied here.
- Because heavy verification friction is disliked, use confidence-gated review (only ask when unsure) instead of confirming every filing.
- "Ask your brain" answers should cite the user's own captured fragments so users can verify rather than trust model memory.
- Voice notes about health, relationships, medication and emotions are highly sensitive; given the sector's poor privacy record, clear data-use policy, no ad-tech sharing, and export/delete controls are likely trust differentiators.
- Over-reliance concern for ADHD is mostly framed as a positive (externalization is the clinical goal), so the risk is less "dependence" and more silent mis-filing or loss of data the user can no longer recall independently.

### Gaps
- No controlled trial of LLM assistants for adults with ADHD.
- No research found on undo/reversibility as a trust mechanism, or on automation bias specifically in ADHD populations.
- No ADHD-specific survey on privacy attitudes toward AI note-taking apps.
