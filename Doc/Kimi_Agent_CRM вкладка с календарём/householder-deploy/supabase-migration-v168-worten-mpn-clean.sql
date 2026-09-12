-- v168: очистка ложных MPN («resca» — срабатывание regex на слово «Refresca» в меню)
update parse_products set mpn = null
  where site = 'canarias.worten.es' and (mpn = 'resca' or mpn !~ '\d' or length(mpn) < 4);
