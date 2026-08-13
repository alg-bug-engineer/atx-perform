-- 奥体西问题路段晚高峰指标（示例，17:00-19:00 → step 204-227）
SELECT link_id, day_of_week, step_index,
       avg_speed_kmh, delay_index
FROM xianchang.dws_link_index_5min_mm
WHERE link_id = '12wwe28fmwwe28ct01'
  AND day_of_week = 1
  AND step_index BETWEEN 204 AND 227
  AND COALESCE(is_deleted,0)=0
ORDER BY step_index;
