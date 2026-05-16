do $$
declare
  s_count int; c_count int; t_count int;
begin
  delete from trading.signals; get diagnostics s_count = row_count;
  delete from catalog.candles; get diagnostics c_count = row_count;
  delete from catalog.candle_timestamps; get diagnostics t_count = row_count;
  raise notice 'signals=% candles=% timestamps=%', s_count, c_count, t_count;
end$$;