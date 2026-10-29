BEGIN TRANSACTION READ ONLY;
SELECT count(*) total,count(*) FILTER(WHERE status='active') active,count(*) FILTER(WHERE status='inactive') inactive,count(*) FILTER(WHERE item_type IS NULL OR btrim(item_type)='') missing_type FROM public.master_items;
SELECT item_type,family,unit,status,count(*) FROM public.master_items GROUP BY item_type,family,unit,status ORDER BY item_type,family,unit,status;
SELECT description,count(*),array_agg(primary_sku) skus FROM public.master_items GROUP BY description HAVING count(*)>1;
SELECT regexp_replace(primary_sku_normalized,'\s+',' ','g') candidate,count(*),array_agg(primary_sku) skus FROM public.master_items GROUP BY candidate HAVING count(*)>1;
SELECT a.normalized_code,count(DISTINCT a.item_id) products FROM public.item_aliases a WHERE a.status='active' GROUP BY a.normalized_code HAVING count(DISTINCT a.item_id)>1;
SELECT a.namespace,a.original_code,a.item_id,i.id primary_product FROM public.item_aliases a JOIN public.master_items i ON i.primary_sku_normalized=a.normalized_code WHERE a.item_id<>i.id;
SELECT count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.product_bom_lines b WHERE b.parent_product_id=i.id)) with_bom,count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM public.product_bom_lines b WHERE b.parent_product_id=i.id)) without_bom,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.product_routing_steps r WHERE r.product_id=i.id)) with_routing,count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM public.product_routing_steps r WHERE r.product_id=i.id)) without_routing FROM public.master_items i;
ROLLBACK;
