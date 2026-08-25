# 业务常量（与 docs/data-contract.md 一致，Live 实现不得静默覆盖）
DOWNSTREAM_INTER_ID = "011wwe28ctu00001"
UPSTREAM_INTER_ID = "011wwe28fmc00001"
PROBLEM_LINK_ID = "12wwe28fmwwe28ct01"
QUEUE_LENGTH_M_EXPERT = 270

# 数据集名 → data/ 文件（与 frontend/src/services/loadSceneData.js 对齐）
DATASET_FILES = {
    "objects": "1-scene-objects.json",
    "opening": "1-0-opening.json",
    "channelization": "1-1-channelization.json",
    "locate": "1-1-problem-locate.json",
    "cause": "1-2-cause-analysis.json",
    "flowTrace": "1-2-flow-trace.json",
    "optimization": "1-3-optimization.json",
    "signalPlan": "1-3-signal-plan.json",
    "effect": "1-4-effect-eval.json",
    "skill": "1-5-skill-solidify.json",
    "sniff": "1-sniff-report.json",
}

SCENE_DATASETS = {
    "0": ["objects", "opening"],
    "1": ["objects", "locate", "channelization"],
    "2": ["objects", "cause", "flowTrace"],
    "3": ["optimization", "signalPlan"],
    "4": ["effect", "optimization"],
    "5": ["skill"],
}
