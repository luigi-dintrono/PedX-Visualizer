-- Direct SQL encoding fixes
-- Run this with: psql $DATABASE_URL -f scripts/fix-encoding.sql

SET client_encoding TO 'UTF8';

-- Fix known corrupted city names
UPDATE cities SET city = 'Asunción', updated_at = CURRENT_TIMESTAMP WHERE city = 'Asunci¨®n';
UPDATE cities SET city = 'Łódź', updated_at = CURRENT_TIMESTAMP WHERE city = '?¨®d?';
UPDATE cities SET city = 'Balneário Camboriú', updated_at = CURRENT_TIMESTAMP WHERE city = 'Balne¨¢rio Cambori¨²';
UPDATE cities SET city = 'Białystok', updated_at = CURRENT_TIMESTAMP WHERE city = 'Bia?ystok';
UPDATE cities SET city = 'Chișinău', updated_at = CURRENT_TIMESTAMP WHERE city = 'Chi?in?u';
UPDATE cities SET city = 'Gżira', updated_at = CURRENT_TIMESTAMP WHERE city = 'G?ira';
UPDATE cities SET city = 'Korçë', updated_at = CURRENT_TIMESTAMP WHERE city = 'Kor??';
UPDATE cities SET city = 'Lourinhã', updated_at = CURRENT_TIMESTAMP WHERE city = 'Lourinh?';
UPDATE cities SET city = 'Nukuʻalofa', updated_at = CURRENT_TIMESTAMP WHERE city = 'Nuku?alofa';
UPDATE cities SET city = 'Pärnu', updated_at = CURRENT_TIMESTAMP WHERE city = 'P?rnu';
UPDATE cities SET city = 'Rîbnița', updated_at = CURRENT_TIMESTAMP WHERE city = 'R?bni?a';
UPDATE cities SET city = 'Saint-François', updated_at = CURRENT_TIMESTAMP WHERE city = 'Saint-Fran?ois';
UPDATE cities SET city = 'Xırdalan', updated_at = CURRENT_TIMESTAMP WHERE city = 'X?rdalan';
UPDATE cities SET city = 'José Pedro Varela', updated_at = CURRENT_TIMESTAMP WHERE city = 'Jos¨¦ Pedro Varela';
UPDATE cities SET city = 'Lomé', updated_at = CURRENT_TIMESTAMP WHERE city = 'Lom¨¦';
UPDATE cities SET city = 'Macapá', updated_at = CURRENT_TIMESTAMP WHERE city = 'Macap¨¢';
UPDATE cities SET city = 'Malé', updated_at = CURRENT_TIMESTAMP WHERE city = 'Mal¨¦';
UPDATE cities SET city = 'München', updated_at = CURRENT_TIMESTAMP WHERE city = 'M¨¹nchen';
UPDATE cities SET city = 'Nazaré', updated_at = CURRENT_TIMESTAMP WHERE city = 'Nazar¨¦';
UPDATE cities SET city = 'Nouméa', updated_at = CURRENT_TIMESTAMP WHERE city = 'Noum¨¦a';
UPDATE cities SET city = 'Pointe-à-Pitre', updated_at = CURRENT_TIMESTAMP WHERE city = 'Pointe-¨¤-Pitre';
UPDATE cities SET city = 'Puerto Suárez', updated_at = CURRENT_TIMESTAMP WHERE city = 'Puerto Su¨¢rez';
UPDATE cities SET city = 'Salé', updated_at = CURRENT_TIMESTAMP WHERE city = 'Sal¨¦';
UPDATE cities SET city = 'San José de Chiquitos', updated_at = CURRENT_TIMESTAMP WHERE city = 'San Jos¨¦ de Chiquitos';
UPDATE cities SET city = 'San José', updated_at = CURRENT_TIMESTAMP WHERE city = 'San Jos¨¦';
UPDATE cities SET city = 'Sant Julià de Lòria', updated_at = CURRENT_TIMESTAMP WHERE city = 'Sant Juli¨¤ de L¨°ria';
UPDATE cities SET city = 'Tulcán', updated_at = CURRENT_TIMESTAMP WHERE city = 'Tulc¨¢n';
UPDATE cities SET city = 'Tétouan', updated_at = CURRENT_TIMESTAMP WHERE city = 'T¨¦touan';
UPDATE cities SET city = 'Yaoundé', updated_at = CURRENT_TIMESTAMP WHERE city = 'Yaound¨¦';

-- Fix countries
UPDATE cities SET country = 'Côte d''Ivoire', updated_at = CURRENT_TIMESTAMP WHERE country = 'C?te d''Ivoire';
UPDATE cities SET country = 'Türkiye', updated_at = CURRENT_TIMESTAMP WHERE country = 'T¨¹rkiye';
UPDATE cities SET country = 'Curaçao', updated_at = CURRENT_TIMESTAMP WHERE country = 'Cura?ao';

-- Show results
SELECT 'Fixed cities:' as status;
SELECT city, country FROM cities WHERE updated_at > NOW() - INTERVAL '1 minute' ORDER BY city;

