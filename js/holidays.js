let holidaysCache = {};

export async function fetchHolidays(year){
    if(holidaysCache[year]) return holidaysCache[year];

    const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/CL`);
    const data = await r.json();

    const h = {};
    data.forEach(d=>{
        const [year, month, day] = d.date.split("-");
        h[`${year}-${month-1}-${day}`] = true;
    });

    holidaysCache[year] = h;
    return h;
}