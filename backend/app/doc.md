### Agent Design

- 開發設計 Agent 時，儘量先求把環路跑通，確定 policy + stop，比先把腦子做大更重要
- 接著如何做大？
	1. HPC runner: 從本機實驗升級成 HPC orchestration
	2. 換成 MCP: 做成可被模型 / 其他 agent 調用的 tool layer
	3. 換 Bayesian optimizer / Thompson sampling: 讓系統自己從歷史結果中學，哪些參數看起來比較有希望，哪些還不確定但值得試一下
	4. Parallel sweeps: 一次同時丟很多組參數去跑，跑完再一起比較看誰好
	5. Telemetry & provenance: 把每輪過程和結果記清楚，未來可以查、比、重現

### Bandit policy

它是機器學習裡一種很常見的輕量決策方法，當有很多可選 action 時，如何聰明地選下一個要試的 action？
- exploitation: 先選目前看起來最好的那個
- exploration: 去試那些你還不確定，但可能更好的選項
兩者平衡，在「穩穩用目前最好的」和「偶爾試試可能更好的」之間取得平衡，會更好
- ε-greedy: 大部分時間選目前最好，小部分時間隨機探索
- UCB: 不只看平均表現，還會對「還沒試很多次」的選項給探索加分，所以他會偏好平均不錯的或者雖然不確定，但值得再試的
- Thompson Sampling: 對每個選擇都維持一個「我認為它有多強」的機率分布，每輪都從這個 belief 裡抽一次，抽到最高的就選
- contextual bandit: 多考慮情境因素來選擇

### Context stuffing

先把資料塞進去再讓模型自己找重點；在資料少、問題準、模型強時很好用，尤其現在一堆模型好棒棒，所以效果其實很不錯，但資料一亂，就有一定概率會出事。

### Agent Benchmark

- AST：模型有沒有叫對工具，而且參數也叫對 = 工具調用看起來對
- Pass@1：模型最後一次作答，有沒有真的把任務做對 = 整個任務真的成功

Agent 的難點不只是 tool selection，還包括多步驟推理、狀態追蹤、結果整合、最後回答，而 Tool Selection 本質上是把很多工具描述塞進 context，本身就是一種 context stuffing

### Tool Selection

- **Context overflow / dilution**
    - 塞進去的文件、工具、schema 越多，attention 就越分散
    - 就算 context window 很大，也不代表模型更會挑重點
    - 問題不是「裝不下」，而是「看不準」
- **No structured grounding**
    - 模型可能把只是剛好一起放進 context 的內容，錯當成彼此有關
    - 也就是會亂腦補文件之間的關係
    - 因為沒有明確的 provenance、邏輯結構、依據鏈
- **Implicit reasoning load**
    - 模型同時要做兩件事：
        1. 判斷哪些資訊 relevant
        2. 用那些資訊做推理
    - 兩件一起做，負擔很重，容易失誤
- **Token efficiency and cost**
    - 工具多、schema 多時，全部塞進去超浪費
    - 不只慢，也更貴

- Solution
	- 更好的做法是先做「結構化檢索與路由」，再讓 agent 規劃與執行。
	- 別把所有東西直接丟給 LLM，而是先做一層 router，把最可能有用的 schema / tool / context 先找出來、打分，再交給 planner。
		1. Query reception — Router: 根據 query 對每個 schema/tool 分別做 retrieval 與 scoring
		2. Planning — Agentic planner: 根據 router 回傳的候選結果，決定要用哪些工具、怎麼用、順序是什麼
		3. Execution — Executor: 真正去調工具、跑模型、跑工作流
		4. Feedback — Logs / verifier: 看有沒有成功、延遲多少、品質如何
		5. Adaptation — Router: 根據 feedback 更新 router 的權重、tool/schema 的匹配規則
	- Agent System 比 naive RAG/ naive MCP 成熟的地方就是合理分工
	- planner 最好具備「成本感知」的能力，知道怎麼吃 low hanging fruit
	- 要有修正的 loop 且當信心分低最好 human-in-loop 問人類
	- 工具描述不是寫死，可以根據過去成功使用案例，自動濃縮成更好的說明文件，是一個 long-term improvement
	- 讓他變成 tool ecosystem，它也應該是會成長、會學習的基礎設施