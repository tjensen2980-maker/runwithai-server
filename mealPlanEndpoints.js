// ============================================
// MEAL PLAN ENDPOINTS
// AI-generated daily meal plans based on user profile + goals
// Mounted via registerMealPlanEndpoints(app, pool, authMiddleware)
// ============================================

function registerMealPlanEndpoints(app, pool, authMiddleware) {

  // POST /meal-plan/generate - generate a daily meal plan with AI
  app.post('/meal-plan/generate', authMiddleware, async function (req, res) {
    try {
      const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
      if (!ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'AI ikke konfigureret' });
      }

      const userId = req.userId;
      const body = req.body || {};
      const meals_per_day = parseInt(body.meals_per_day, 10) || 4;
      const preferences = body.preferences || '';
      const allergies = body.allergies || '';
      const dislikes = body.dislikes || '';

      // Fetch profile
      const profileRes = await pool.query(
        'SELECT data FROM profile WHERE user_id = $1',
        [userId]
      );
      let profile = profileRes.rows[0] ? profileRes.rows[0].data : {};
      if (typeof profile === 'string') {
        try { profile = JSON.parse(profile); } catch (e) { profile = {}; }
      }
      profile = profile || {};

      // Fetch goals
      const goalsRes = await pool.query(
        'SELECT * FROM user_goals WHERE user_id = $1',
        [userId]
      );
      const goals = goalsRes.rows[0] || {};

      const targetKcal = goals.target_kcal || 2000;
      const targetProtein = goals.target_protein_g || Math.round(targetKcal * 0.25 / 4);
      const targetCarbs = goals.target_carbs_g || Math.round(targetKcal * 0.50 / 4);
      const targetFat = goals.target_fat_g || Math.round(targetKcal * 0.25 / 9);
      const primaryGoal = goals.primary_goal || 'maintain';

      const goalLabel =
        primaryGoal === 'lose_fat' ? 'tabe fedt' :
        primaryGoal === 'gain_muscle' ? 'oege muskelmasse' :
        primaryGoal === 'run_faster' ? 'loebe hurtigere' :
        primaryGoal === 'run_longer' ? 'loebe laengere' :
        'vedligeholde vaegt';

      // Build prompt
      const userInfoLines = [];
      if (profile.weight_kg || profile.weight) userInfoLines.push('Vaegt: ' + (profile.weight_kg || profile.weight) + ' kg');
      if (profile.height_cm || profile.height) userInfoLines.push('Hoejde: ' + (profile.height_cm || profile.height) + ' cm');
      if (profile.age) userInfoLines.push('Alder: ' + profile.age);
      if (profile.gender) userInfoLines.push('Koen: ' + profile.gender);

      const constraintLines = [];
      if (preferences) constraintLines.push('Praeferencer: ' + preferences);
      if (allergies) constraintLines.push('Allergier (UNDGAA): ' + allergies);
      if (dislikes) constraintLines.push('Kan ikke lide: ' + dislikes);

      const systemPrompt =
        'Du er en dansk ernaeringsekspert der laver praktiske, velsmagende madplaner. ' +
        'Du svarer ALTID kun med ren JSON uden markdown eller forklaring udenom. ' +
        'JSON skal have feltet "meals" som en array af objekter med felterne: ' +
        'meal_type (breakfast/lunch/dinner/snack), name (kort dansk titel), ' +
        'description (1-2 saetninger), kcal (tal), protein_g (tal), carbs_g (tal), fat_g (tal), ' +
        'ingredients (array af strings med praktiske maengder, fx "100g havregryn", "1 banan"). ' +
        'Tag hensyn til tid paa dagen: morgenmad er let og hurtig, ' +
        'frokost giver energi, aftensmad er maettende, snacks er smaa. ' +
        'Total kcal i alle maaltider skal ramme +/- 100 kcal af brugerens kalorimaal. ' +
        'Total protein skal ramme +/- 10g af proteinmaalet.';

      const userPrompt =
        'Lav en madplan for i dag med ' + meals_per_day + ' maaltider.\n\n' +
        'BRUGERMAAL: ' + goalLabel + '\n' +
        'KCAL/DAG: ' + targetKcal + '\n' +
        'PROTEIN/DAG: ' + targetProtein + 'g\n' +
        'KULHYDRAT/DAG: ' + targetCarbs + 'g\n' +
        'FEDT/DAG: ' + targetFat + 'g\n\n' +
        (userInfoLines.length > 0 ? 'BRUGERINFO:\n' + userInfoLines.join('\n') + '\n\n' : '') +
        (constraintLines.length > 0 ? 'KONSTRAINTS:\n' + constraintLines.join('\n') + '\n\n' : '') +
        'Returner KUN gyldig JSON.';

      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2500,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      const aiData = await anthropicRes.json();
      if (!anthropicRes.ok) {
        console.error('Anthropic meal plan error:', aiData);
        return res.status(500).json({ error: 'AI fejl', details: aiData });
      }

      const textBlock = (aiData.content || []).find(function (b) { return b.type === 'text'; });
      const rawText = textBlock ? textBlock.text : '';

      let parsed;
      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { meals: [] };
      } catch (e) {
        console.error('Meal plan JSON parse error:', e, 'Raw:', rawText);
        return res.status(500).json({ error: 'AI svar kunne ikke parses', raw: rawText });
      }

      const meals = Array.isArray(parsed.meals) ? parsed.meals : [];

      // Calculate totals
      let totalKcal = 0, totalProtein = 0, totalCarbs = 0, totalFat = 0;
      meals.forEach(function (m) {
        totalKcal += parseFloat(m.kcal) || 0;
        totalProtein += parseFloat(m.protein_g) || 0;
        totalCarbs += parseFloat(m.carbs_g) || 0;
        totalFat += parseFloat(m.fat_g) || 0;
      });

      res.json({
        meals: meals,
        targets: {
          kcal: targetKcal,
          protein_g: targetProtein,
          carbs_g: targetCarbs,
          fat_g: targetFat,
        },
        totals: {
          kcal: Math.round(totalKcal),
          protein_g: Math.round(totalProtein),
          carbs_g: Math.round(totalCarbs),
          fat_g: Math.round(totalFat),
        },
        goal: primaryGoal,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Meal plan generate error:', err);
      res.status(500).json({ error: 'Kunne ikke generere madplan' });
    }
  });

  // POST /meal-plan/log - log a meal from the AI plan into meals/meal_items
  app.post('/meal-plan/log', authMiddleware, async function (req, res) {
    const client = await pool.connect();
    try {
      const userId = req.userId;
      const body = req.body || {};
      const meal = body.meal || {};
      const eatenAt = body.eaten_at || new Date().toISOString();

      if (!meal.name || !meal.kcal) {
        return res.status(400).json({ error: 'Mangler maaltidsdata' });
      }

      await client.query('BEGIN');

      const mealResult = await client.query(
        'INSERT INTO meals (user_id, eaten_at, meal_type, notes) ' +
        'VALUES ($1, $2, $3, $4) RETURNING *',
        [userId, eatenAt, meal.meal_type || null, meal.name]
      );
      const dbMeal = mealResult.rows[0];

      await client.query(
        'INSERT INTO meal_items (meal_id, food_id, amount_g, kcal, protein_g, carbs_g, fat_g) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          dbMeal.id,
          null,
          100,
          parseFloat(meal.kcal) || 0,
          parseFloat(meal.protein_g) || 0,
          parseFloat(meal.carbs_g) || 0,
          parseFloat(meal.fat_g) || 0,
        ]
      );

      await client.query('COMMIT');
      res.json({ success: true, meal_id: dbMeal.id });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Meal plan log error:', err);
      res.status(500).json({ error: 'Kunne ikke logge maaltid' });
    } finally {
      client.release();
    }
  });

}

module.exports = { registerMealPlanEndpoints };