use chrono::{DateTime, Datelike, Days, NaiveDate, NaiveTime, Timelike, Utc};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error};

use super::ValidationError;

// Longest gap between two matches: a monthly rule always matches once per month.
const MAX_SEARCH_DAYS: u64 = 62;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecurrenceFrequency {
    Daily,
    Weekly,
    Monthly,
}

impl RecurrenceFrequency {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ValidationError> {
        match value {
            "daily" => Ok(Self::Daily),
            "weekly" => Ok(Self::Weekly),
            "monthly" => Ok(Self::Monthly),
            _ => Err(invalid()),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecurrenceMode {
    Schedule,
    AfterCompletion,
}

impl RecurrenceMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Schedule => "schedule",
            Self::AfterCompletion => "after_completion",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ValidationError> {
        match value {
            "schedule" => Ok(Self::Schedule),
            "after_completion" => Ok(Self::AfterCompletion),
            _ => Err(invalid()),
        }
    }
}

/// What happens at each occurrence: a new copy of the latest Task, or the same
/// Task reset in place.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecurrenceAction {
    #[default]
    Duplicate,
    Reset,
}

impl RecurrenceAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Duplicate => "duplicate",
            Self::Reset => "reset",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ValidationError> {
        match value {
            "duplicate" => Ok(Self::Duplicate),
            "reset" => Ok(Self::Reset),
            _ => Err(invalid()),
        }
    }
}

/// A Task repeat rule. Weekdays use ISO numbering (1 = Monday, 7 = Sunday);
/// monthly days past the end of a month clamp to its last day.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RecurrenceRule {
    pub frequency: RecurrenceFrequency,
    #[serde(default)]
    pub weekdays: Vec<u8>,
    #[serde(default)]
    pub month_day: Option<u8>,
    #[serde(
        serialize_with = "serialize_time",
        deserialize_with = "deserialize_time"
    )]
    pub time: NaiveTime,
    pub mode: RecurrenceMode,
    #[serde(default)]
    pub action: RecurrenceAction,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Occurrence {
    pub date: NaiveDate,
    pub at: DateTime<Utc>,
}

impl RecurrenceRule {
    /// Validates the rule and returns it with sorted, unique weekdays.
    pub fn normalized(mut self) -> Result<Self, ValidationError> {
        self.weekdays.sort_unstable();
        self.weekdays.dedup();
        let weekly = self.frequency == RecurrenceFrequency::Weekly;
        if weekly == self.weekdays.is_empty() {
            return Err(ValidationError::new(
                "Weekly repeats require weekdays; other repeats cannot have them",
            ));
        }
        if self.weekdays.iter().any(|day| !(1..=7).contains(day)) {
            return Err(ValidationError::new("Repeat weekdays must be 1 through 7"));
        }
        let monthly = self.frequency == RecurrenceFrequency::Monthly;
        match self.month_day {
            Some(day) if monthly && (1..=31).contains(&day) => {}
            None if !monthly => {}
            _ => {
                return Err(ValidationError::new(
                    "Monthly repeats require a day from 1 to 31; other repeats cannot have one",
                ));
            }
        }
        if self.time.second() != 0 || self.time.nanosecond() != 0 {
            return Err(ValidationError::new("Repeat time must use whole minutes"));
        }
        Ok(self)
    }

    pub fn matches(&self, date: NaiveDate) -> bool {
        match self.frequency {
            RecurrenceFrequency::Daily => true,
            RecurrenceFrequency::Weekly => {
                let weekday = date.weekday().number_from_monday() as u8;
                self.weekdays.contains(&weekday)
            }
            RecurrenceFrequency::Monthly => {
                let day = u32::from(self.month_day.unwrap_or(1));
                date.day() == day.min(last_day_of_month(date))
            }
        }
    }

    /// The first occurrence on a calendar day strictly after `date`.
    pub fn occurrence_after(
        &self,
        timezone: &str,
        date: NaiveDate,
    ) -> Result<Occurrence, ValidationError> {
        let mut candidate = date;
        for _ in 0..MAX_SEARCH_DAYS {
            candidate = candidate
                .checked_add_days(Days::new(1))
                .ok_or_else(invalid)?;
            if self.matches(candidate) {
                return self.occurrence_on(timezone, candidate);
            }
        }
        Err(invalid())
    }

    /// The first occurrence after `anchor` that is also later than `now`.
    pub fn next_after(
        &self,
        timezone: &str,
        anchor: NaiveDate,
        now: DateTime<Utc>,
    ) -> Result<Occurrence, ValidationError> {
        let yesterday = local_date(timezone, now)?
            .checked_sub_days(Days::new(1))
            .ok_or_else(invalid)?;
        let mut occurrence = self.occurrence_after(timezone, anchor.max(yesterday))?;
        while occurrence.at <= now {
            occurrence = self.occurrence_after(timezone, occurrence.date)?;
        }
        Ok(occurrence)
    }

    /// The latest occurrence after `anchor` that is not later than `now`.
    /// Missed occurrences collapse into this one instead of being replayed.
    pub fn latest_due(
        &self,
        timezone: &str,
        anchor: NaiveDate,
        now: DateTime<Utc>,
    ) -> Result<Option<Occurrence>, ValidationError> {
        let mut candidate = local_date(timezone, now)?;
        for _ in 0..=MAX_SEARCH_DAYS {
            if candidate <= anchor {
                return Ok(None);
            }
            if self.matches(candidate) {
                let occurrence = self.occurrence_on(timezone, candidate)?;
                if occurrence.at <= now {
                    return Ok(Some(occurrence));
                }
            }
            candidate = candidate
                .checked_sub_days(Days::new(1))
                .ok_or_else(invalid)?;
        }
        Ok(None)
    }

    fn occurrence_on(
        &self,
        timezone: &str,
        date: NaiveDate,
    ) -> Result<Occurrence, ValidationError> {
        let civil = jiff::civil::date(
            i16::try_from(date.year()).map_err(|_| invalid())?,
            i8::try_from(date.month()).map_err(|_| invalid())?,
            i8::try_from(date.day()).map_err(|_| invalid())?,
        )
        .at(
            i8::try_from(self.time.hour()).map_err(|_| invalid())?,
            i8::try_from(self.time.minute()).map_err(|_| invalid())?,
            0,
            0,
        );
        // Times skipped by a DST gap resolve forward; repeated times use the
        // earlier instant.
        let timestamp = civil
            .in_tz(timezone)
            .map_err(|_| invalid_timezone())?
            .timestamp();
        let at = DateTime::from_timestamp(timestamp.as_second(), 0).ok_or_else(invalid)?;
        Ok(Occurrence { date, at })
    }
}

pub fn local_date(timezone: &str, at: DateTime<Utc>) -> Result<NaiveDate, ValidationError> {
    let timestamp = jiff::Timestamp::from_second(at.timestamp()).map_err(|_| invalid())?;
    super::local_reference_date(timestamp, timezone).map_err(|_| invalid_timezone())
}

fn last_day_of_month(date: NaiveDate) -> u32 {
    let (year, month) = if date.month() == 12 {
        (date.year() + 1, 1)
    } else {
        (date.year(), date.month() + 1)
    };
    NaiveDate::from_ymd_opt(year, month, 1)
        .and_then(|first| first.pred_opt())
        .map_or(28, |last| last.day())
}

fn serialize_time<S: Serializer>(time: &NaiveTime, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&time.format("%H:%M").to_string())
}

fn deserialize_time<'de, D: Deserializer<'de>>(deserializer: D) -> Result<NaiveTime, D::Error> {
    let raw = String::deserialize(deserializer)?;
    if raw.len() != 5 {
        return Err(D::Error::custom("Repeat time must use HH:MM"));
    }
    NaiveTime::parse_from_str(&raw, "%H:%M")
        .map_err(|_| D::Error::custom("Repeat time must use HH:MM"))
}

fn invalid() -> ValidationError {
    ValidationError::new("Invalid repeat rule")
}

fn invalid_timezone() -> ValidationError {
    ValidationError::new("Repeat timezone is not valid")
}

#[cfg(test)]
mod tests {
    use chrono::{NaiveDate, NaiveTime, TimeZone, Utc};
    use serde_json::json;

    use super::{RecurrenceAction, RecurrenceFrequency, RecurrenceMode, RecurrenceRule};

    fn date(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    fn weekly(days: &[u8], time: &str) -> RecurrenceRule {
        RecurrenceRule {
            frequency: RecurrenceFrequency::Weekly,
            weekdays: days.to_vec(),
            month_day: None,
            time: NaiveTime::parse_from_str(time, "%H:%M").unwrap(),
            mode: RecurrenceMode::Schedule,
            action: RecurrenceAction::Duplicate,
        }
    }

    #[test]
    fn parses_and_normalizes_rules() {
        let rule: RecurrenceRule = serde_json::from_value(json!({
            "frequency": "weekly",
            "weekdays": [5, 1, 1],
            "time": "07:30",
            "mode": "schedule",
            "action": "reset"
        }))
        .unwrap();
        let rule = rule.normalized().unwrap();
        assert_eq!(rule.weekdays, vec![1, 5]);
        assert_eq!(
            serde_json::to_value(&rule).unwrap(),
            json!({
                "frequency": "weekly",
                "weekdays": [1, 5],
                "month_day": null,
                "time": "07:30",
                "mode": "schedule",
                "action": "reset"
            })
        );
        let defaulted: RecurrenceRule = serde_json::from_value(json!({
            "frequency": "daily", "time": "07:00", "mode": "schedule"
        }))
        .unwrap();
        assert_eq!(defaulted.action, RecurrenceAction::Duplicate);
        assert!(
            serde_json::from_value::<RecurrenceRule>(json!({
                "frequency": "daily", "time": "07:00", "mode": "schedule", "action": "move"
            }))
            .is_err()
        );
    }

    #[test]
    fn rejects_inconsistent_rules() {
        assert!(weekly(&[], "07:00").normalized().is_err());
        assert!(weekly(&[8], "07:00").normalized().is_err());
        let mut daily = weekly(&[1], "07:00");
        daily.frequency = RecurrenceFrequency::Daily;
        assert!(daily.clone().normalized().is_err());
        daily.weekdays.clear();
        assert!(daily.clone().normalized().is_ok());
        daily.month_day = Some(3);
        assert!(daily.normalized().is_err());
        let mut monthly = weekly(&[], "07:00");
        monthly.frequency = RecurrenceFrequency::Monthly;
        assert!(monthly.clone().normalized().is_err());
        monthly.month_day = Some(32);
        assert!(monthly.clone().normalized().is_err());
        monthly.month_day = Some(31);
        assert!(monthly.normalized().is_ok());
        for time in ["7:00", "07:00:00", "24:00", "ab:cd"] {
            assert!(
                serde_json::from_value::<RecurrenceRule>(json!({
                    "frequency": "daily", "time": time, "mode": "schedule"
                }))
                .is_err(),
                "{time}"
            );
        }
        assert!(
            serde_json::from_value::<RecurrenceRule>(json!({
                "frequency": "daily", "time": "07:00", "mode": "schedule", "extra": 1
            }))
            .is_err()
        );
    }

    #[test]
    fn finds_weekly_occurrences_in_the_rule_timezone() {
        let rule = weekly(&[1], "07:00");
        // Sunday 2026-11-01 in Ho Chi Minh City (UTC+7).
        let occurrence = rule
            .occurrence_after("Asia/Ho_Chi_Minh", date(2026, 11, 1))
            .unwrap();
        assert_eq!(occurrence.date, date(2026, 11, 2));
        assert_eq!(
            occurrence.at,
            Utc.with_ymd_and_hms(2026, 11, 2, 0, 0, 0).unwrap()
        );
        let monday = rule
            .occurrence_after("Asia/Ho_Chi_Minh", date(2026, 11, 2))
            .unwrap();
        assert_eq!(monday.date, date(2026, 11, 9));
    }

    #[test]
    fn next_after_skips_the_anchor_day_and_past_times() {
        let rule = weekly(&[1], "07:00");
        let now = Utc.with_ymd_and_hms(2026, 11, 2, 1, 0, 0).unwrap();
        let next = rule
            .next_after("Asia/Ho_Chi_Minh", date(2026, 11, 2), now)
            .unwrap();
        assert_eq!(next.date, date(2026, 11, 9));
        let next = rule
            .next_after("Asia/Ho_Chi_Minh", date(2026, 1, 5), now)
            .unwrap();
        assert_eq!(next.date, date(2026, 11, 9));
        let early = Utc.with_ymd_and_hms(2026, 11, 1, 23, 0, 0).unwrap();
        let next = rule
            .next_after("Asia/Ho_Chi_Minh", date(2026, 10, 26), early)
            .unwrap();
        assert_eq!(next.date, date(2026, 11, 2));
    }

    #[test]
    fn latest_due_collapses_missed_occurrences() {
        let rule = weekly(&[1], "07:00");
        let now = Utc.with_ymd_and_hms(2026, 11, 18, 0, 0, 0).unwrap();
        let due = rule
            .latest_due("Asia/Ho_Chi_Minh", date(2026, 10, 26), now)
            .unwrap()
            .unwrap();
        assert_eq!(due.date, date(2026, 11, 16));
        assert!(
            rule.latest_due("Asia/Ho_Chi_Minh", date(2026, 11, 16), now)
                .unwrap()
                .is_none()
        );
        let before_time =
            Utc.with_ymd_and_hms(2026, 11, 2, 23, 0, 0).unwrap() - chrono::Days::new(1);
        assert!(
            rule.latest_due("Asia/Ho_Chi_Minh", date(2026, 10, 26), before_time)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn monthly_days_clamp_to_short_months() {
        let mut rule = weekly(&[], "09:00");
        rule.frequency = RecurrenceFrequency::Monthly;
        rule.month_day = Some(31);
        assert_eq!(
            rule.occurrence_after("UTC", date(2026, 1, 31))
                .unwrap()
                .date,
            date(2026, 2, 28)
        );
        assert_eq!(
            rule.occurrence_after("UTC", date(2028, 1, 31))
                .unwrap()
                .date,
            date(2028, 2, 29)
        );
        assert_eq!(
            rule.occurrence_after("UTC", date(2026, 3, 30))
                .unwrap()
                .date,
            date(2026, 3, 31)
        );
    }

    #[test]
    fn daylight_saving_gaps_resolve_to_a_real_instant() {
        let mut rule = weekly(&[], "02:30");
        rule.frequency = RecurrenceFrequency::Daily;
        // 2026-03-08 02:30 does not exist in New York.
        let occurrence = rule
            .occurrence_after("America/New_York", date(2026, 3, 7))
            .unwrap();
        assert_eq!(occurrence.date, date(2026, 3, 8));
        assert_eq!(
            occurrence.at,
            Utc.with_ymd_and_hms(2026, 3, 8, 7, 30, 0).unwrap()
        );
        assert!(
            rule.occurrence_after("Not/AZone", date(2026, 3, 7))
                .is_err()
        );
    }
}
