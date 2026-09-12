-- v169: убрать EAN (штрихкод) из колонки № производителя у Worten — туда пойдёт Modelo
update parse_products set mpn = null
  where site = 'canarias.worten.es' and mpn ~ '^\d{12,14}$';
