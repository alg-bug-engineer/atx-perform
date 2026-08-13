-- 取数模板：奥体西路与解放东路路口（inter_id=011wwe28fmc00001）
-- 时段：07:00–09:00；方向：北向南
-- 说明：本文件为参数化取数模板，占位符 :inter_id / :start_time / :end_time
--       由调用方在执行时注入；本模板不含任何示例结果行。
SELECT
    link.inter_id,
    link.link_id,
    inter.inter_name
FROM road9.dwd_tfc_rltn_wide_inter_ft_link AS link
JOIN road9.dim_inter_info AS inter
    ON inter.inter_id = link.inter_id
WHERE link.inter_id = :inter_id
  AND :start_time <= :end_time
ORDER BY link.inter_id, link.link_id;
